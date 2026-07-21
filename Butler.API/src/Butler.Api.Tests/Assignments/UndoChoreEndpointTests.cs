using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Criteria (undo): <c>POST /households/{householdId}/assignments/{weekIso}/{choreId}/undo</c>
/// reverses a completion - it flips the assignment from <c>Done</c> back to
/// <c>Open</c> and appends a compensating append-only entry that backs the credited
/// effort out (visible as the person's fairness effort returning to zero), so the
/// C3 trailing-load read reflects the reversal. Authorization matches C4: a
/// participant session or a paired hub device may drive it with no organizer
/// authority, an actorless hub call is a <c>400</c>, undoing an already-<c>Open</c>
/// assignment is an idempotent success, and an unknown assignment is a <c>404</c>
/// RFC 7807 problem document. The default factory runs in Development, so the
/// ambient caller is the dev organizer.
/// </summary>
public sealed class UndoChoreEndpointTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public UndoChoreEndpointTests(ButlerApiFactory factory) => _factory = factory;

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

    // Generates the current week (server-computed from the clock, so the completion
    // always lands inside the clock-anchored fairness window) and returns that week
    // plus the first placed assignment's (choreId, assignedPersonId).
    private static async Task<(string Week, string ChoreId, string PersonId)> GenerateWeekAsync(
        HttpClient client, string householdId)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/generate", UriKind.Relative),
            new { });
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        var week = doc.RootElement.GetProperty("weekIso").GetString()!;
        var first = doc.RootElement.GetProperty("assignments").EnumerateArray().First();
        return (week, first.GetProperty("choreId").GetString()!, first.GetProperty("assignedPersonId").GetString()!);
    }

    private static async Task<(string HouseholdId, string Week, string ChoreId, string PersonId)> SeedWeekAsync(
        HttpClient client, int effort = 3)
    {
        var householdId = await CreateHouseholdAsync(client);
        var roomId = await CreateRoomAsync(client, householdId);
        await CreateChoreAsync(client, householdId, roomId, "Dishes", effort);
        var (week, choreId, personId) = await GenerateWeekAsync(client, householdId);
        return (householdId, week, choreId, personId);
    }

    private static async Task CompleteAsync(HttpClient client, string householdId, string week, string choreId, string personId)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/{week}/{choreId}/complete", UriKind.Relative),
            new { personId });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // The person's completed effort as the fairness read (a sum over the append-only
    // ledger) reports it - the same source the C3 trailing-load math reads.
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

    [Fact]
    public async Task Undo_reverses_a_completion_and_backs_the_effort_out()
    {
        using var client = _factory.CreateClient();
        var (householdId, week, choreId, personId) = await SeedWeekAsync(client, effort: 3);

        await CompleteAsync(client, householdId, week, choreId, personId);
        Assert.Equal(3, await FairnessEffortAsync(client, householdId, personId));

        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/{week}/{choreId}/undo", UriKind.Relative),
            new { personId });

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("Open", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal(choreId, doc.RootElement.GetProperty("choreId").GetString());
        Assert.Equal(week, doc.RootElement.GetProperty("weekIso").GetString());

        // The append-only reversal nets the credited effort back to zero, so the C3
        // trailing-load read (the fairness sum) reflects the reversal.
        Assert.Equal(0, await FairnessEffortAsync(client, householdId, personId));
    }

    [Fact]
    public async Task Undo_of_an_open_assignment_is_an_idempotent_success()
    {
        using var client = _factory.CreateClient();
        var (householdId, week, choreId, personId) = await SeedWeekAsync(client, effort: 4);

        // A freshly-generated assignment is Open (never completed): undo succeeds as
        // a no-op and does not subtract any effort.
        using var first = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/{week}/{choreId}/undo", UriKind.Relative),
            new { personId });
        var firstBody = await first.Content.ReadAsStringAsync();
        Assert.True(first.StatusCode == HttpStatusCode.OK, firstBody);
        using var firstDoc = JsonDocument.Parse(firstBody);
        Assert.Equal("Open", firstDoc.RootElement.GetProperty("status").GetString());
        Assert.Equal(0, await FairnessEffortAsync(client, householdId, personId));

        // Complete, then undo twice: the second undo is a no-op that never
        // double-subtracts (effort stays at zero, not negative).
        await CompleteAsync(client, householdId, week, choreId, personId);
        var undoUri = new Uri($"/households/{householdId}/assignments/{week}/{choreId}/undo", UriKind.Relative);
        using (var undo1 = await client.PostAsJsonAsync(undoUri, new { personId }))
        {
            Assert.Equal(HttpStatusCode.OK, undo1.StatusCode);
        }

        using var undo2 = await client.PostAsJsonAsync(undoUri, new { personId });
        Assert.Equal(HttpStatusCode.OK, undo2.StatusCode);
        Assert.Equal(0, await FairnessEffortAsync(client, householdId, personId));
    }

    [Fact]
    public async Task Undo_unknown_assignment_is_404_problem_details()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/2026-W29/{Guid.NewGuid():N}/undo", UriKind.Relative),
            new { personId = "person-1" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(404, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("Assignment not found.", doc.RootElement.GetProperty("title").GetString());
    }

    [Fact]
    public async Task A_participant_session_may_undo()
    {
        using var client = _factory.CreateClient();
        var (householdId, week, choreId, _) = await SeedWeekAsync(client);

        // A participant session carries its own actor: no body personId needed, and
        // no organizer authority is required. Complete then undo as that participant.
        var personId = Guid.NewGuid().ToString("N");
        var token = ParticipantSession.Encode(householdId, personId);

        using (var complete = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri($"/households/{householdId}/assignments/{week}/{choreId}/complete", UriKind.Relative)))
        {
            complete.Headers.TryAddWithoutValidation(ParticipantSession.HeaderName, token);
            using var completed = await client.SendAsync(complete);
            Assert.Equal(HttpStatusCode.OK, completed.StatusCode);
        }

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri($"/households/{householdId}/assignments/{week}/{choreId}/undo", UriKind.Relative));
        request.Headers.TryAddWithoutValidation(ParticipantSession.HeaderName, token);

        using var response = await client.SendAsync(request);

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("Open", doc.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_paired_hub_device_may_undo()
    {
        using var client = _factory.CreateClient();
        var (householdId, week, choreId, personId) = await SeedWeekAsync(client);
        await CompleteAsync(client, householdId, week, choreId, personId);

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
            new Uri($"/households/{householdId}/assignments/{week}/{choreId}/undo", UriKind.Relative))
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
            new Uri($"/households/{householdId}/assignments/{week}/{choreId}/undo", UriKind.Relative));
        request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, deviceToken);

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }
}
