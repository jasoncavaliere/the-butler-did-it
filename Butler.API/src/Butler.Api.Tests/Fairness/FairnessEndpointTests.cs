using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Fairness;

/// <summary>
/// Criteria (C6): <c>GET /households/{householdId}/fairness</c> returns the
/// household's contribution balance over a trailing window - per person, their
/// completed effort and share of the household total. An unknown household is a
/// <c>404</c> RFC 7807 problem details document, a non-positive window is a
/// <c>400</c>, and a household with no completions returns a well-formed zero
/// result. The default factory runs in Development on the real system clock, so
/// completions are seeded into the current week (the empty-body generate) and the
/// default trailing window - anchored to that same clock - includes them.
/// </summary>
public sealed class FairnessEndpointTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public FairnessEndpointTests(ButlerApiFactory factory) => _factory = factory;

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

    private static async Task<string> CreateRoomAsync(HttpClient client, string householdId)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/rooms", UriKind.Relative),
            new { name = "Kitchen", sortOrder = 1 });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("roomId").GetString()!;
    }

    private static async Task CreateChoreAsync(HttpClient client, string householdId, string roomId, string title, int effort)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/chores", UriKind.Relative),
            new { title, roomId, cadence = "Weekly", effort, minAge = (int?)null });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // Generates the current week (empty body) and completes its one chore, so the
    // completion lands in the week the default fairness window is anchored to.
    // Seeds a chore-doing member (participant). The seeded organizer administers the
    // household but is never assigned chores, so a household needs a participant for
    // a completion to be attributed to.
    private static async Task CreateParticipantAsync(HttpClient client, string householdId, string displayName)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/people", UriKind.Relative),
            new { displayName, role = "Participant", isChild = false, claimColor = (string?)null });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task<(string PersonId, int Effort)> SeedCompletionAsync(
        HttpClient client, string householdId, int effort)
    {
        await CreateParticipantAsync(client, householdId, "Jamie");
        var roomId = await CreateRoomAsync(client, householdId);
        await CreateChoreAsync(client, householdId, roomId, "Dishes", effort);

        using var generate = await client.PostAsync(
            new Uri($"/households/{householdId}/assignments/generate", UriKind.Relative),
            content: null);
        var genBody = await generate.Content.ReadAsStringAsync();
        Assert.True(generate.StatusCode == HttpStatusCode.OK, genBody);
        using var genDoc = JsonDocument.Parse(genBody);
        var week = genDoc.RootElement.GetProperty("weekIso").GetString()!;
        var first = genDoc.RootElement.GetProperty("assignments").EnumerateArray().First();
        var choreId = first.GetProperty("choreId").GetString()!;
        var personId = first.GetProperty("assignedPersonId").GetString()!;

        using var complete = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/{week}/{choreId}/complete", UriKind.Relative),
            new { personId });
        Assert.Equal(HttpStatusCode.OK, complete.StatusCode);

        return (personId, effort);
    }

    [Fact]
    public async Task Returns_the_balance_with_the_top_contributor_at_full_share()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var (personId, effort) = await SeedCompletionAsync(client, householdId, effort: 5);

        using var response = await client.GetAsync(
            new Uri($"/households/{householdId}/fairness", UriKind.Relative));

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        Assert.Equal(4, root.GetProperty("windowWeeks").GetInt32());
        Assert.Equal(effort, root.GetProperty("totalEffort").GetInt32());
        Assert.Equal(personId, root.GetProperty("topContributorPersonId").GetString());

        var shares = root.GetProperty("shares");
        var top = shares.EnumerateArray().Single(s => s.GetProperty("personId").GetString() == personId);
        Assert.Equal(effort, top.GetProperty("totalEffort").GetInt32());
        Assert.Equal(1.0d, top.GetProperty("share").GetDouble(), 9);
        Assert.Equal(100.0d, top.GetProperty("sharePercent").GetDouble(), 3);
    }

    [Fact]
    public async Task Honours_the_window_weeks_query_parameter()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        await SeedCompletionAsync(client, householdId, effort: 2);

        using var response = await client.GetAsync(
            new Uri($"/households/{householdId}/fairness?windowWeeks=1", UriKind.Relative));

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        // The completion is in the current week, so a 1-week window still counts it.
        Assert.Equal(1, doc.RootElement.GetProperty("windowWeeks").GetInt32());
        Assert.Equal(2, doc.RootElement.GetProperty("totalEffort").GetInt32());
    }

    [Fact]
    public async Task A_household_with_no_completions_returns_a_zero_result()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var response = await client.GetAsync(
            new Uri($"/households/{householdId}/fairness", UriKind.Relative));

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        Assert.Equal(0, root.GetProperty("totalEffort").GetInt32());
        // No top contributor and a well-formed (possibly empty) shares list.
        Assert.Equal(JsonValueKind.Null, root.GetProperty("topContributorPersonId").ValueKind);
    }

    [Fact]
    public async Task Unknown_household_is_404_problem_details()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(
            new Uri($"/households/{Guid.NewGuid():N}/fairness", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(404, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("Household not found.", doc.RootElement.GetProperty("title").GetString());
    }

    [Fact]
    public async Task A_non_positive_window_is_a_400()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var response = await client.GetAsync(
            new Uri($"/households/{householdId}/fairness?windowWeeks=0", UriKind.Relative));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }
}
