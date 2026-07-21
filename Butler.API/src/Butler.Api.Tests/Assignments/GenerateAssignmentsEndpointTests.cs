using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Criteria (C3): <c>POST /households/{householdId}/assignments/generate</c>
/// generates the week's assignments over the household's active chores and people
/// and returns the resulting set. It may be triggered by an organizer or a paired
/// hub device, but a plain participant session is rejected; an unknown household
/// is a <c>404</c> RFC 7807 problem details document. The default factory runs in
/// Development, so the ambient caller is the dev organizer.
/// </summary>
public sealed class GenerateAssignmentsEndpointTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public GenerateAssignmentsEndpointTests(ButlerApiFactory factory) => _factory = factory;

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

    // Seeds a chore-doing member (participant). The seeded organizer administers the
    // household but is never assigned chores, so a household needs a participant for
    // the engine to place work on.
    private static async Task CreateParticipantAsync(HttpClient client, string householdId, string displayName)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/people", UriKind.Relative),
            new { displayName, role = "Participant", isChild = false, claimColor = (string?)null });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Organizer_generates_assignments_for_the_households_active_chores()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        await CreateParticipantAsync(client, householdId, "Jamie");
        var roomId = await CreateRoomAsync(client, householdId);
        await CreateChoreAsync(client, householdId, roomId, "Dishes", effort: 3);
        await CreateChoreAsync(client, householdId, roomId, "Trash", effort: 2);

        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/generate", UriKind.Relative),
            new { weekIso = "2026-W29" });

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        Assert.Equal("2026-W29", root.GetProperty("weekIso").GetString());

        // Both active chores are assigned (to the seeded participant, the only
        // chore-doing member - the organizer administers but never does chores).
        var assignments = root.GetProperty("assignments");
        Assert.Equal(2, assignments.GetArrayLength());
        Assert.All(
            assignments.EnumerateArray(),
            a => Assert.False(string.IsNullOrWhiteSpace(a.GetProperty("assignedPersonId").GetString())));
        Assert.Empty(root.GetProperty("unassigned").EnumerateArray());
    }

    [Fact]
    public async Task Generate_with_no_body_uses_the_current_week()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var roomId = await CreateRoomAsync(client, householdId);
        await CreateChoreAsync(client, householdId, roomId, "Dishes", effort: 3);

        // An empty POST is allowed; the server computes the week from its clock.
        using var response = await client.PostAsync(
            new Uri($"/households/{householdId}/assignments/generate", UriKind.Relative),
            content: null);

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        Assert.False(string.IsNullOrWhiteSpace(doc.RootElement.GetProperty("weekIso").GetString()));
    }

    [Fact]
    public async Task Regenerate_is_idempotent_and_returns_the_week_again()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        await CreateParticipantAsync(client, householdId, "Jamie");
        var roomId = await CreateRoomAsync(client, householdId);
        await CreateChoreAsync(client, householdId, roomId, "Dishes", effort: 3);

        var uri = new Uri($"/households/{householdId}/assignments/generate", UriKind.Relative);
        using var first = await client.PostAsJsonAsync(uri, new { weekIso = "2026-W29" });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        // Regenerating the same week again is safe and returns the same set.
        using var second = await client.PostAsJsonAsync(uri, new { weekIso = "2026-W29" });
        var body = await second.Content.ReadAsStringAsync();
        Assert.True(second.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        Assert.Single(doc.RootElement.GetProperty("assignments").EnumerateArray());
    }

    [Fact]
    public async Task Unknown_household_is_404_problem_details()
    {
        using var client = _factory.CreateClient();

        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{Guid.NewGuid():N}/assignments/generate", UriKind.Relative),
            new { weekIso = "2026-W29" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(404, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("Household not found.", doc.RootElement.GetProperty("title").GetString());
    }

    [Fact]
    public async Task A_participant_session_is_forbidden()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        // A participant session routes to the participant scheme (never the
        // organizer role), so it is authenticated-but-forbidden at this endpoint.
        var token = ParticipantSession.Encode(householdId, Guid.NewGuid().ToString("N"));
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri($"/households/{householdId}/assignments/generate", UriKind.Relative))
        {
            Content = JsonContent.Create(new { weekIso = "2026-W29" }),
        };
        request.Headers.TryAddWithoutValidation(ParticipantSession.HeaderName, token);

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_paired_hub_device_may_generate()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var roomId = await CreateRoomAsync(client, householdId);
        await CreateChoreAsync(client, householdId, roomId, "Dishes", effort: 3);

        // Pair a device (organizer action) and then act as that device.
        using var pair = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/hub-devices/pair", UriKind.Relative),
            new { deviceName = "Kitchen hub" });
        Assert.Equal(HttpStatusCode.OK, pair.StatusCode);
        using var pairDoc = JsonDocument.Parse(await pair.Content.ReadAsStringAsync());
        var deviceToken = pairDoc.RootElement.GetProperty("token").GetString()!;

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri($"/households/{householdId}/assignments/generate", UriKind.Relative))
        {
            Content = JsonContent.Create(new { weekIso = "2026-W29" }),
        };
        request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, deviceToken);

        using var response = await client.SendAsync(request);

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
    }

    [Fact]
    public async Task A_malformed_week_is_a_400()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/generate", UriKind.Relative),
            new { weekIso = "nonsense" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
