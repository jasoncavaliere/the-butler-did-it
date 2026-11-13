using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Criteria (issue #86), end to end through the real HTTP pipeline with a pinned
/// clock: complete and undo accept only the current ISO week, or the previous week
/// within 24 hours of the Monday 00:00 UTC rollover. A stale week is a <c>409</c>
/// RFC 7807 problem (<c>type</c> https://httpstatuses.io/409, extensions
/// <c>reason</c> = <c>weekNotCurrent</c>, <c>requestedWeekIso</c>,
/// <c>currentWeekIso</c>) and writes nothing: no completion is appended and a
/// rejected undo leaves the assignment <c>Done</c>.
/// </summary>
public sealed class ChoreWeekWindowEndpointTests
{
    private const string Week29 = "2026-W29";

    // A Wednesday in 2026-W29, the W30 rollover, and a Monday in 2026-W31 (two weeks
    // after W29, so W29 is outside any grace window).
    private static readonly DateTimeOffset MidWeek29 = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Week30Rollover = new(2026, 7, 20, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset MondayWeek31 = new(2026, 7, 27, 10, 0, 0, TimeSpan.Zero);

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

    // Seeds a household with one participant and one chore, generates 2026-W29, and
    // returns the first placed assignment.
    private static async Task<(string HouseholdId, string ChoreId, string PersonId)> SeedWeek29Async(HttpClient client)
    {
        var householdId = await CreateHouseholdAsync(client);

        using (var person = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/people", UriKind.Relative),
            new { displayName = "Jamie", role = "Participant", isChild = false, claimColor = (string?)null }))
        {
            Assert.Equal(HttpStatusCode.Created, person.StatusCode);
        }

        string roomId;
        using (var room = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/rooms", UriKind.Relative),
            new { name = "Kitchen", sortOrder = 1 }))
        {
            Assert.Equal(HttpStatusCode.Created, room.StatusCode);
            using var roomDoc = JsonDocument.Parse(await room.Content.ReadAsStringAsync());
            roomId = roomDoc.RootElement.GetProperty("roomId").GetString()!;
        }

        using (var chore = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/chores", UriKind.Relative),
            new { title = "Dishes", roomId, cadence = "Weekly", effort = 3, minAge = (int?)null }))
        {
            Assert.Equal(HttpStatusCode.Created, chore.StatusCode);
        }

        var first = await GenerateWeek29FirstAsync(client, householdId);
        return (householdId, first.GetProperty("choreId").GetString()!, first.GetProperty("assignedPersonId").GetString()!);
    }

    // Generates (or regenerates) 2026-W29 and returns its first placed assignment.
    private static async Task<JsonElement> GenerateWeek29FirstAsync(HttpClient client, string householdId)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/generate", UriKind.Relative),
            new { weekIso = Week29 });
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("assignments").EnumerateArray().First().Clone();
    }

    private static Task<HttpResponseMessage> PostAsync(
        HttpClient client, string householdId, string choreId, string personId, string action) =>
        client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/{Week29}/{choreId}/{action}", UriKind.Relative),
            new { personId });

    private static async Task<int> FairnessEffortAsync(HttpClient client, string householdId, string personId)
    {
        using var response = await client.GetAsync(
            new Uri($"/households/{householdId}/fairness", UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        foreach (var share in doc.RootElement.GetProperty("shares").EnumerateArray())
        {
            if (share.GetProperty("personId").GetString() == personId)
            {
                return share.GetProperty("totalEffort").GetInt32();
            }
        }

        return 0;
    }

    private static async Task AssertWeekNotCurrentProblemAsync(HttpResponseMessage response, string currentWeek)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Conflict, body);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        Assert.Equal(409, root.GetProperty("status").GetInt32());
        Assert.Equal("https://httpstatuses.io/409", root.GetProperty("type").GetString());
        Assert.Equal("weekNotCurrent", root.GetProperty("reason").GetString());
        Assert.Equal(Week29, root.GetProperty("requestedWeekIso").GetString());
        Assert.Equal(currentWeek, root.GetProperty("currentWeekIso").GetString());
    }

    [Fact]
    public async Task Complete_into_a_stale_week_is_409_week_not_current_problem()
    {
        var clock = new MutableClock(MidWeek29);
        using var factory = CreateFactory(clock);
        using var client = factory.CreateClient();
        var (householdId, choreId, personId) = await SeedWeek29Async(client);

        // Two weeks later, W29 is closed.
        clock.Set(MondayWeek31);
        using var response = await PostAsync(client, householdId, choreId, personId, "complete");

        await AssertWeekNotCurrentProblemAsync(response, "2026-W31");

        // Nothing was appended: the person has no completed effort, and W29 is still Open.
        Assert.Equal(0, await FairnessEffortAsync(client, householdId, personId));
        var regenerated = await GenerateWeek29FirstAsync(client, householdId);
        Assert.Equal("Open", regenerated.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Complete_previous_week_after_grace_is_409()
    {
        var clock = new MutableClock(MidWeek29);
        using var factory = CreateFactory(clock);
        using var client = factory.CreateClient();
        var (householdId, choreId, personId) = await SeedWeek29Async(client);

        clock.Set(Week30Rollover.AddHours(24));
        using var response = await PostAsync(client, householdId, choreId, personId, "complete");

        await AssertWeekNotCurrentProblemAsync(response, "2026-W30");
    }

    [Fact]
    public async Task Undo_into_a_stale_week_is_409_and_leaves_the_assignment_done()
    {
        var clock = new MutableClock(MidWeek29);
        using var factory = CreateFactory(clock);
        using var client = factory.CreateClient();
        var (householdId, choreId, personId) = await SeedWeek29Async(client);

        using (var complete = await PostAsync(client, householdId, choreId, personId, "complete"))
        {
            Assert.Equal(HttpStatusCode.OK, complete.StatusCode);
        }

        Assert.Equal(3, await FairnessEffortAsync(client, householdId, personId));

        clock.Set(MondayWeek31);
        using var response = await PostAsync(client, householdId, choreId, personId, "undo");

        await AssertWeekNotCurrentProblemAsync(response, "2026-W31");

        // No compensating entry was appended and the assignment is still Done.
        Assert.Equal(3, await FairnessEffortAsync(client, householdId, personId));
        var regenerated = await GenerateWeek29FirstAsync(client, householdId);
        Assert.Equal("Done", regenerated.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Complete_previous_week_within_grace_is_200()
    {
        var clock = new MutableClock(MidWeek29);
        using var factory = CreateFactory(clock);
        using var client = factory.CreateClient();
        var (householdId, choreId, personId) = await SeedWeek29Async(client);

        // One second before the 24h grace after the W30 rollover ends, W29 is open.
        clock.Set(Week30Rollover.AddHours(24).AddSeconds(-1));
        using var response = await PostAsync(client, householdId, choreId, personId, "complete");

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("Done", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal(Week29, doc.RootElement.GetProperty("weekIso").GetString());
    }

    [Fact]
    public async Task Undo_previous_week_within_grace_is_200()
    {
        var clock = new MutableClock(MidWeek29);
        using var factory = CreateFactory(clock);
        using var client = factory.CreateClient();
        var (householdId, choreId, personId) = await SeedWeek29Async(client);

        using (var complete = await PostAsync(client, householdId, choreId, personId, "complete"))
        {
            Assert.Equal(HttpStatusCode.OK, complete.StatusCode);
        }

        clock.Set(Week30Rollover.AddHours(23));
        using var response = await PostAsync(client, householdId, choreId, personId, "undo");

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("Open", doc.RootElement.GetProperty("status").GetString());
    }
}
