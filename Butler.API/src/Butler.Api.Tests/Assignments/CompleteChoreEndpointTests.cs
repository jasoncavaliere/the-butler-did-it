using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Criteria (C4): <c>POST /households/{householdId}/assignments/{weekIso}/{choreId}/complete</c>
/// flips the assignment to <c>Done</c> and appends a completion. Completion is not
/// a sensitive action (D-3), so a participant session or a paired hub device may
/// drive it with no organizer authority; a double-complete is an idempotent
/// success; and an unknown assignment is a <c>404</c> RFC 7807 problem details
/// document. The default factory runs in Development, so the ambient caller is the
/// dev organizer.
/// </summary>
public sealed class CompleteChoreEndpointTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public CompleteChoreEndpointTests(ButlerApiFactory factory) => _factory = factory;

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

    // Generates a week and returns the first placed assignment's (choreId, assignedPersonId).
    private static async Task<(string ChoreId, string PersonId)> GenerateWeekAsync(
        HttpClient client, string householdId, string weekIso)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/generate", UriKind.Relative),
            new { weekIso });
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        var first = doc.RootElement.GetProperty("assignments").EnumerateArray().First();
        return (first.GetProperty("choreId").GetString()!, first.GetProperty("assignedPersonId").GetString()!);
    }

    private static async Task<(string HouseholdId, string Week, string ChoreId, string PersonId)> SeedWeekAsync(
        HttpClient client, string weekIso = "2026-W29")
    {
        var householdId = await CreateHouseholdAsync(client);
        var roomId = await CreateRoomAsync(client, householdId);
        await CreateChoreAsync(client, householdId, roomId, "Dishes", effort: 3);
        var (choreId, personId) = await GenerateWeekAsync(client, householdId, weekIso);
        return (householdId, weekIso, choreId, personId);
    }

    [Fact]
    public async Task Organizer_completes_and_the_assignment_flips_to_done()
    {
        using var client = _factory.CreateClient();
        var (householdId, week, choreId, personId) = await SeedWeekAsync(client);

        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/{week}/{choreId}/complete", UriKind.Relative),
            new { personId });

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("Done", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal(choreId, doc.RootElement.GetProperty("choreId").GetString());
        Assert.Equal(week, doc.RootElement.GetProperty("weekIso").GetString());
    }

    [Fact]
    public async Task Double_complete_is_idempotent()
    {
        using var client = _factory.CreateClient();
        var (householdId, week, choreId, personId) = await SeedWeekAsync(client);
        var uri = new Uri($"/households/{householdId}/assignments/{week}/{choreId}/complete", UriKind.Relative);

        using var first = await client.PostAsJsonAsync(uri, new { personId });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        // Completing an already-Done assignment succeeds again, not an error.
        using var second = await client.PostAsJsonAsync(uri, new { personId });
        var body = await second.Content.ReadAsStringAsync();
        Assert.True(second.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("Done", doc.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Unknown_assignment_is_404_problem_details()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/2026-W29/{Guid.NewGuid():N}/complete", UriKind.Relative),
            new { personId = "person-1" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(404, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("Assignment not found.", doc.RootElement.GetProperty("title").GetString());
    }

    [Fact]
    public async Task A_participant_session_may_complete()
    {
        using var client = _factory.CreateClient();
        var (householdId, week, choreId, _) = await SeedWeekAsync(client);

        // A participant session carries its own actor: no body personId needed, and
        // no organizer authority is required.
        var token = ParticipantSession.Encode(householdId, Guid.NewGuid().ToString("N"));
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri($"/households/{householdId}/assignments/{week}/{choreId}/complete", UriKind.Relative));
        request.Headers.TryAddWithoutValidation(ParticipantSession.HeaderName, token);

        using var response = await client.SendAsync(request);

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("Done", doc.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_paired_hub_device_may_complete()
    {
        using var client = _factory.CreateClient();
        var (householdId, week, choreId, personId) = await SeedWeekAsync(client);

        // Pair a device (organizer action), then act as that device with the active
        // participant supplied in the body.
        using var pair = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/hub-devices/pair", UriKind.Relative),
            new { deviceName = "Kitchen hub" });
        Assert.Equal(HttpStatusCode.OK, pair.StatusCode);
        using var pairDoc = JsonDocument.Parse(await pair.Content.ReadAsStringAsync());
        var deviceToken = pairDoc.RootElement.GetProperty("token").GetString()!;

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri($"/households/{householdId}/assignments/{week}/{choreId}/complete", UriKind.Relative))
        {
            Content = JsonContent.Create(new { personId }),
        };
        request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, deviceToken);

        using var response = await client.SendAsync(request);

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
    }

    [Fact]
    public async Task A_hub_device_with_no_actor_is_a_400()
    {
        using var client = _factory.CreateClient();
        var (householdId, week, choreId, _) = await SeedWeekAsync(client);

        using var pair = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/hub-devices/pair", UriKind.Relative),
            new { deviceName = "Kitchen hub" });
        using var pairDoc = JsonDocument.Parse(await pair.Content.ReadAsStringAsync());
        var deviceToken = pairDoc.RootElement.GetProperty("token").GetString()!;

        // A hub device is not a person; with no body personId there is no actor.
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri($"/households/{householdId}/assignments/{week}/{choreId}/complete", UriKind.Relative));
        request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, deviceToken);

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }
}
