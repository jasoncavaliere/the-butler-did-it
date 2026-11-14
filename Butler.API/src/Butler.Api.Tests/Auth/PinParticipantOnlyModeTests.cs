using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Auth;

/// <summary>
/// Criteria (#105 AC22, AC23): in Demo with the PIN organizer, a paired hub with
/// no organizer signed in (only <c>X-Device-Token</c>) still reads its household
/// and completes, undoes, generates, and captures - the participant-only mode the
/// hub falls back to after sign-out or token expiry.
/// </summary>
public sealed class PinParticipantOnlyModeTests
{
    // A Wednesday in ISO week 2026-W29, so complete/undo stay inside the week window.
    private static readonly DateTimeOffset MidWeek29 = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);
    private const string Week = "2026-W29";

    private static async Task<JsonElement> OrganizerPostAsync(HttpClient client, string token, string path, object body)
    {
        using var response = await PinSignIn.SendWithBearerAsync(
            client, HttpMethod.Post, new Uri(path, UriKind.Relative), token, JsonContent.Create(body));
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, text);
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.Clone();
    }

    private static async Task<HttpResponseMessage> DeviceSendAsync(
        HttpClient client, HttpMethod method, string path, string deviceToken, object? body = null)
    {
        using var request = new HttpRequestMessage(method, new Uri(path, UriKind.Relative))
        {
            Content = body is null ? null : JsonContent.Create(body),
        };
        request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, deviceToken);
        return await client.SendAsync(request);
    }

    // Organizer (PIN) sets up a household with a participant, room, and chore, and
    // pairs the hub; then signs out, leaving only the device token.
    private static async Task<(string HouseholdId, string DeviceToken, string PersonId)> SetUpPairedHubAsync(HttpClient client)
    {
        var token = await PinSignIn.TokenAsync(client);
        var householdId = (await OrganizerPostAsync(client, token, "/households", new { name = "Home" }))
            .GetProperty("householdId").GetString()!;
        var personId = (await OrganizerPostAsync(
                client, token, $"/households/{householdId}/people",
                new { displayName = "Jamie", role = "Participant", isChild = false, claimColor = (string?)null }))
            .GetProperty("personId").GetString()!;
        var roomId = (await OrganizerPostAsync(
                client, token, $"/households/{householdId}/rooms", new { name = "Kitchen", sortOrder = 1 }))
            .GetProperty("roomId").GetString()!;
        await OrganizerPostAsync(
            client, token, $"/households/{householdId}/chores",
            new { title = "Dishes", roomId, cadence = "Weekly", effort = 3, minAge = (int?)null });
        var deviceToken = (await OrganizerPostAsync(
                client, token, $"/households/{householdId}/hub-devices/pair", new { deviceName = "Kitchen hub" }))
            .GetProperty("token").GetString()!;

        using var signOut = await PinSignIn.SendWithBearerAsync(client, HttpMethod.Post, PinSignIn.SignOutUri, token);
        Assert.Equal(HttpStatusCode.NoContent, signOut.StatusCode);

        return (householdId, deviceToken, personId);
    }

    [Fact]
    public async Task Paired_hub_reads_the_household_without_an_organizer()
    {
        using var factory = PinSignIn.CreateDemoFactory(new MutableClock(MidWeek29));
        using var client = factory.CreateClient();
        var (householdId, deviceToken, _) = await SetUpPairedHubAsync(client);

        using var response = await DeviceSendAsync(client, HttpMethod.Get, $"/households/{householdId}", deviceToken);

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("Home", doc.RootElement.GetProperty("name").GetString());

        // Creating a household stays organizer-only.
        using var create = await DeviceSendAsync(client, HttpMethod.Post, "/households", deviceToken, new { name = "Other" });
        Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);
    }

    [Fact]
    public async Task Paired_hub_completes_undoes_generates_and_captures_without_an_organizer()
    {
        using var factory = PinSignIn.CreateDemoFactory(new MutableClock(MidWeek29));
        using var client = factory.CreateClient();
        var (householdId, deviceToken, personId) = await SetUpPairedHubAsync(client);

        using var generate = await DeviceSendAsync(
            client, HttpMethod.Post, $"/households/{householdId}/assignments/generate", deviceToken, new { weekIso = Week });
        var generated = await generate.Content.ReadAsStringAsync();
        Assert.True(generate.StatusCode == HttpStatusCode.OK, generated);
        using var generatedDoc = JsonDocument.Parse(generated);
        var assignment = generatedDoc.RootElement.GetProperty("assignments").EnumerateArray().First();
        var choreId = assignment.GetProperty("choreId").GetString()!;
        var assignee = assignment.GetProperty("assignedPersonId").GetString()!;
        Assert.Equal(personId, assignee);

        var choreRoute = $"/households/{householdId}/assignments/{Week}/{choreId}";
        using var complete = await DeviceSendAsync(client, HttpMethod.Post, $"{choreRoute}/complete", deviceToken, new { personId });
        Assert.True(complete.StatusCode == HttpStatusCode.OK, await complete.Content.ReadAsStringAsync());

        using var undo = await DeviceSendAsync(client, HttpMethod.Post, $"{choreRoute}/undo", deviceToken, new { personId });
        Assert.True(undo.StatusCode == HttpStatusCode.OK, await undo.Content.ReadAsStringAsync());

        using var capture = await DeviceSendAsync(
            client, HttpMethod.Post, $"/households/{householdId}/capture/text", deviceToken,
            new { utterance = "add oat milk", personId, weekIso = Week });
        Assert.True(capture.StatusCode == HttpStatusCode.OK, await capture.Content.ReadAsStringAsync());
    }
}
