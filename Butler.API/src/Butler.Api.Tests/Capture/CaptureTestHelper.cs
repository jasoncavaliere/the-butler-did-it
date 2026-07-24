using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;

namespace Butler.Api.Tests.Capture;

/// <summary>
/// Shared plumbing for the G3 capture endpoint tests: create a household, POST an
/// utterance at one of the capture routes (optionally as a tap-to-claim
/// participant), and read a week's cart back. Kept in one place so the capture
/// test classes assert behaviour rather than repeat HTTP scaffolding.
/// </summary>
internal static class CaptureTestHelper
{
    /// <summary>The hub text capture route for a household.</summary>
    internal static Uri TextRoute(string householdId) =>
        new($"/households/{householdId}/capture/text", UriKind.Relative);

    /// <summary>The simulated voice capture route for a household.</summary>
    internal static Uri VoiceRoute(string householdId) =>
        new($"/households/{householdId}/capture/voice", UriKind.Relative);

    internal static async Task<string> CreateHouseholdAsync(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri("/households", UriKind.Relative),
            new { name = "Home" });
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Created, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("householdId").GetString()!;
    }

    /// <summary>
    /// Posts a capture body. <paramref name="participantToken"/> presents a
    /// tap-to-claim session instead of relying on the ambient dev organizer.
    /// </summary>
    internal static async Task<HttpResponseMessage> PostAsync(
        HttpClient client,
        Uri route,
        object body,
        string? participantToken = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, route)
        {
            Content = JsonContent.Create(body),
        };

        if (participantToken is not null)
        {
            request.Headers.TryAddWithoutValidation(ParticipantSession.HeaderName, participantToken);
        }

        return await client.SendAsync(request);
    }

    /// <summary>
    /// Posts a capture route with <b>no body at all</b> - the shape a caller sends
    /// when it relies entirely on its participant session. The routes allow an
    /// empty body, so this must still produce a problem document rather than a
    /// <c>500</c>.
    /// </summary>
    internal static async Task<HttpResponseMessage> PostEmptyAsync(
        HttpClient client,
        Uri route,
        string? participantToken = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, route);

        if (participantToken is not null)
        {
            request.Headers.TryAddWithoutValidation(ParticipantSession.HeaderName, participantToken);
        }

        return await client.SendAsync(request);
    }

    /// <summary>Posts a capture body and asserts it succeeded, returning the response JSON.</summary>
    internal static async Task<JsonElement> CaptureAsync(
        HttpClient client,
        Uri route,
        object body,
        string? participantToken = null)
    {
        using var response = await PostAsync(client, route, body, participantToken);
        return await ReadOkAsync(response);
    }

    internal static async Task<JsonElement> ReadOkAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    /// <summary>Reads one week's cart (the G2 by-week route) and asserts it exists.</summary>
    internal static async Task<JsonElement> GetCartAsync(HttpClient client, string householdId, string weekIso)
    {
        using var response = await client.GetAsync(
            new Uri($"/households/{householdId}/carts/{weekIso}", UriKind.Relative));
        return await ReadOkAsync(response);
    }

    /// <summary>Reads the household's current building cart (the G2 get-or-create route).</summary>
    internal static async Task<JsonElement> GetCurrentCartAsync(
        HttpClient client,
        string householdId,
        string? weekIso = null)
    {
        var query = weekIso is null ? string.Empty : $"?weekIso={weekIso}";
        using var response = await client.GetAsync(
            new Uri($"/households/{householdId}/carts/current{query}", UriKind.Relative));
        return await ReadOkAsync(response);
    }

    /// <summary>Asserts an RFC 7807 problem details document with the expected status and title.</summary>
    internal static async Task<JsonElement> AssertProblemAsync(
        HttpResponseMessage response,
        HttpStatusCode expectedStatus,
        string expectedTitle)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == expectedStatus, body);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal((int)expectedStatus, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal(expectedTitle, doc.RootElement.GetProperty("title").GetString());
        return doc.RootElement.Clone();
    }
}
