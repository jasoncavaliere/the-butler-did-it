using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Events;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Events;
using Butler.Api.Infrastructure.People;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Tests.Insights;

/// <summary>
/// Criteria (#123 AC1-AC6), end to end through the real HTTP pipeline:
/// <c>GET /households/{householdId}/insights?weeks=N</c> returns the four series
/// to an organizer; a missing, non-numeric, or out-of-range <c>weeks</c> is an
/// RFC 7807 <c>400</c>; a participant session and a paired hub device are
/// <c>403</c>; an unknown household is a <c>404</c>. The clock is a fixed
/// <see cref="MutableClock"/> (Wednesday 2026-07-15 09:00 UTC, ISO week 2026-W29)
/// and rows are seeded straight into the in-memory repositories.
/// </summary>
public sealed class InsightsEndpointTests
{
    private static readonly DateTimeOffset Now = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);
    private static readonly string[] SeededMembers = ["p1", "p2"];
    private static readonly int[] OneCompletionEach = [1, 1];

    private static WebApplicationFactory<Program> CreateFactory(MutableClock clock) =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton<TimeProvider>(clock);
            }));

    private static async Task<string> CreateHouseholdAsync(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri("/households", UriKind.Relative),
            new { name = "Home" });
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Created, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("householdId").GetString()!;
    }

    private static Task<HttpResponseMessage> GetInsightsAsync(
        HttpClient client,
        string householdId,
        string query,
        Action<HttpRequestMessage>? configure = null)
    {
        var request = new HttpRequestMessage(
            HttpMethod.Get,
            new Uri($"/households/{householdId}/insights{query}", UriKind.Relative));
        configure?.Invoke(request);
        return client.SendAsync(request);
    }

    private static async Task SeedAsync(IServiceProvider services, string householdId)
    {
        using var scope = services.CreateScope();
        var people = scope.ServiceProvider.GetRequiredService<IPersonRepository>();
        await people.AddAsync(householdId, new PersonEntity
        {
            RowKey = "p1",
            DisplayName = "Alex",
            Role = "Participant",
            ClaimColor = "#C2185B",
        });
        await people.AddAsync(householdId, new PersonEntity
        {
            RowKey = "p2",
            DisplayName = "Sam",
            Role = "Participant",
        });

        var completions = scope.ServiceProvider.GetRequiredService<IChoreCompletionRepository>();
        await completions.AddAsync(householdId, new ChoreCompletionEntity
        {
            RowKey = $"{Now.UtcTicks}_c1",
            ChoreId = "c1",
            PersonId = "p1",
            Effort = 3,
            WeekIso = "2026-W29",
            CompletedUtc = Now,
        });
        await completions.AddAsync(householdId, new ChoreCompletionEntity
        {
            RowKey = $"{Now.UtcTicks}_c2",
            ChoreId = "c2",
            PersonId = "p2",
            Effort = 1,
            WeekIso = "2026-W29",
            CompletedUtc = Now,
        });

        var events = scope.ServiceProvider.GetRequiredService<IEventRepository>();
        await events.AddAsync(householdId, new EventEntity
        {
            RowKey = $"{Now.AddHours(-1).UtcTicks:D19}_{Guid.NewGuid():N}",
            Type = EventTypes.HubGlanced,
            OccurredUtc = Now.AddHours(-1),
        });

        var carts = scope.ServiceProvider.GetRequiredService<ICartRepository>();
        await carts.AddAsync(householdId, new CartEntity
        {
            RowKey = "2026-W28",
            Status = CartStatus.Confirmed,
            ConfirmedUtc = new DateTimeOffset(2026, 7, 10, 18, 0, 0, TimeSpan.Zero),
        });
    }

    [Fact]
    public async Task An_organizer_gets_the_insights_series()
    {
        using var factory = CreateFactory(new MutableClock(Now));
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        await SeedAsync(factory.Services, householdId);

        using var response = await GetInsightsAsync(client, householdId, "?weeks=2");

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        Assert.Equal("2026-W28", root.GetProperty("windowStartWeekIso").GetString());
        Assert.Equal("2026-W29", root.GetProperty("windowEndWeekIso").GetString());
        Assert.Equal(2, root.GetProperty("windowWeeks").GetInt32());

        // The organizer created with the household is never a member.
        var members = root.GetProperty("members").EnumerateArray().ToArray();
        Assert.Equal(SeededMembers, members.Select(m => m.GetProperty("personId").GetString()));
        Assert.Equal("#C2185B", members[0].GetProperty("claimColor").GetString());

        var weeks = root.GetProperty("weeks").EnumerateArray().ToArray();
        Assert.Equal(2, weeks.Length);
        var current = weeks[1];
        Assert.Equal("2026-W29", current.GetProperty("weekIso").GetString());
        Assert.Equal(4, current.GetProperty("totalEffort").GetInt32());
        Assert.Equal("p1", current.GetProperty("topContributorPersonId").GetString());
        Assert.Equal(0.75d, current.GetProperty("topContributorShare").GetDouble(), 10);
        Assert.Equal(
            OneCompletionEach,
            current.GetProperty("completions").EnumerateArray().Select(c => c.GetProperty("completions").GetInt32()));

        var glances = root.GetProperty("glancesPerDay").EnumerateArray().ToArray();
        Assert.Equal(10, glances.Length); // Mon 2026-07-06 .. Wed 2026-07-15
        Assert.Equal("2026-07-15", glances[^1].GetProperty("date").GetString());
        Assert.Equal(1, glances[^1].GetProperty("count").GetInt32());

        var carts = root.GetProperty("cartsConfirmedPerMonth").EnumerateArray().ToArray();
        var month = Assert.Single(carts);
        Assert.Equal("2026-07", month.GetProperty("month").GetString());
        Assert.Equal(1, month.GetProperty("count").GetInt32());
    }

    [Theory]
    [InlineData("")]
    [InlineData("?weeks=abc")]
    [InlineData("?weeks=0")]
    [InlineData("?weeks=-1")]
    [InlineData("?weeks=53")]
    public async Task Invalid_weeks_is_a_400_problem(string query)
    {
        using var factory = CreateFactory(new MutableClock(Now));
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var response = await GetInsightsAsync(client, householdId, query);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task An_unknown_household_is_a_404_problem()
    {
        using var factory = CreateFactory(new MutableClock(Now));
        using var client = factory.CreateClient();

        using var response = await GetInsightsAsync(client, Guid.NewGuid().ToString("N"), "?weeks=4");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task A_participant_session_is_forbidden()
    {
        using var factory = CreateFactory(new MutableClock(Now));
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var token = ParticipantSession.Encode(householdId, Guid.NewGuid().ToString("N"));

        using var response = await GetInsightsAsync(
            client,
            householdId,
            "?weeks=4",
            request => request.Headers.TryAddWithoutValidation(ParticipantSession.HeaderName, token));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_paired_hub_device_is_forbidden()
    {
        using var factory = CreateFactory(new MutableClock(Now));
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var pairResponse = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/hub-devices/pair", UriKind.Relative),
            new { deviceName = "Kitchen hub" });
        var pairBody = await pairResponse.Content.ReadAsStringAsync();
        Assert.True(pairResponse.StatusCode == HttpStatusCode.OK, pairBody);
        using var pairDoc = JsonDocument.Parse(pairBody);
        var deviceToken = pairDoc.RootElement.GetProperty("token").GetString()!;

        using var response = await GetInsightsAsync(
            client,
            householdId,
            "?weeks=4",
            request => request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, deviceToken));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
