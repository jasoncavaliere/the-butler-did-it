using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Butler.Api.Tests.Chores;

/// <summary>
/// Shared helpers for the Chores integration tests: a chore attaches to a room
/// (H2), so most tests first create a room to point at.
/// </summary>
internal static class ChoreTestHelper
{
    /// <summary>Creates a room in the household and returns its server-generated id.</summary>
    public static async Task<string> CreateRoomAsync(
        HttpClient client,
        string householdId,
        string name,
        int sortOrder)
    {
        var roomsUri = new Uri($"/households/{householdId}/rooms", UriKind.Relative);
        using var response = await client.PostAsJsonAsync(roomsUri, new { name, sortOrder });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var roomId = doc.RootElement.GetProperty("roomId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(roomId));
        return roomId!;
    }

    /// <summary>Creates a chore and returns the parsed response element via the caller's document.</summary>
    public static async Task<(string ChoreId, string ETag)> CreateChoreAsync(
        HttpClient client,
        string householdId,
        string roomId,
        string title = "Dishes",
        string cadence = "Daily",
        int effort = 3)
    {
        var choresUri = new Uri($"/households/{householdId}/chores", UriKind.Relative);
        using var response = await client.PostAsJsonAsync(
            choresUri,
            new { title, roomId, cadence, effort, minAge = (int?)null });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var choreId = doc.RootElement.GetProperty("choreId").GetString()!;
        var etag = doc.RootElement.GetProperty("eTag").GetString()!;
        return (choreId, etag);
    }
}
