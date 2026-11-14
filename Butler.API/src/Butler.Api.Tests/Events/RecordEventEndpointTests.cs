using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Butler.Api.Application.Events;
using Butler.Api.Infrastructure.Events;
using Butler.Api.Tests.TestSupport;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Events;

/// <summary>
/// Criteria (#122 AC7, AC8): <c>POST /households/{householdId}/events</c> records
/// a <c>hub-glanced</c> event and answers <c>204</c>; any other type (including
/// <c>participant-claimed</c>, which only the server records) is an RFC 7807
/// <c>400</c> that records nothing; an unknown household is a <c>404</c>.
/// </summary>
public sealed class RecordEventEndpointTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public RecordEventEndpointTests(ButlerApiFactory factory) => _factory = factory;

    private static Uri EventsRoute(string householdId) =>
        new($"/households/{householdId}/events", UriKind.Relative);

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

    private Task<IReadOnlyList<EventEntity>> EventsAsync(string householdId) =>
        _factory.Services.GetRequiredService<IEventRepository>().ListAsync(householdId, CancellationToken.None);

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == status, body);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal((int)status, doc.RootElement.GetProperty("status").GetInt32());
    }

    [Fact]
    public async Task Posting_hub_glanced_returns_204_and_records_it()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var response = await client.PostAsJsonAsync(EventsRoute(householdId), new { type = "hub-glanced" });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var recorded = Assert.Single(await EventsAsync(householdId));
        Assert.Equal(EventTypes.HubGlanced, recorded.Type);
        Assert.Equal(householdId, recorded.PartitionKey);
        Assert.Null(recorded.PersonId);
        Assert.Null(recorded.ChoreId);
        Assert.Null(recorded.WeekIso);
        Assert.Null(recorded.ItemId);
    }

    [Theory]
    [InlineData("participant-claimed")]
    [InlineData("chore-completed")]
    [InlineData("cart-confirmed")]
    [InlineData("HUB-GLANCED")]
    [InlineData("")]
    [InlineData("nonsense")]
    public async Task Posting_a_non_client_type_is_a_400_problem_and_records_nothing(string type)
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var response = await client.PostAsJsonAsync(EventsRoute(householdId), new { type });

        await AssertProblemAsync(response, HttpStatusCode.BadRequest);
        Assert.Empty(await EventsAsync(householdId));
    }

    [Fact]
    public async Task An_empty_body_is_a_400()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var content = new StringContent(string.Empty, Encoding.UTF8, "application/json");
        using var response = await client.PostAsync(EventsRoute(householdId), content);

        await AssertProblemAsync(response, HttpStatusCode.BadRequest);
        Assert.Empty(await EventsAsync(householdId));
    }

    [Fact]
    public async Task An_unknown_household_is_a_404_and_records_nothing()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");

        using var response = await client.PostAsJsonAsync(EventsRoute(householdId), new { type = "hub-glanced" });

        await AssertProblemAsync(response, HttpStatusCode.NotFound);
        Assert.Empty(await EventsAsync(householdId));
    }
}
