using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Rooms;

/// <summary>
/// Criteria (H2): the Rooms endpoints round-trip create, list, single-read,
/// update, and delete for a household. Runs in the shared Development factory,
/// where the deterministic dev organizer satisfies the <c>Organizer</c> policy on
/// the mutating endpoints without a token.
/// </summary>
public sealed class RoomsCrudTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public RoomsCrudTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Rooms_create_list_update_delete_round_trip()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var roomsUri = new Uri($"/households/{householdId}/rooms", UriKind.Relative);

        // Create -> 201 with server-generated roomId and an ETag.
        using var createResponse = await client.PostAsJsonAsync(
            roomsUri,
            new { name = "Kitchen", sortOrder = 1 });

        var createBody = await createResponse.Content.ReadAsStringAsync();
        Assert.True(createResponse.StatusCode == HttpStatusCode.Created, createBody);

        using var createDoc = JsonDocument.Parse(createBody);
        var created = createDoc.RootElement;
        var roomId = created.GetProperty("roomId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(roomId));
        Assert.Equal("Kitchen", created.GetProperty("name").GetString());
        Assert.Equal(1, created.GetProperty("sortOrder").GetInt32());
        var etag = created.GetProperty("eTag").GetString();
        Assert.False(string.IsNullOrWhiteSpace(etag));

        // The Location header points at the single-room read.
        var roomUri = new Uri($"/households/{householdId}/rooms/{roomId}", UriKind.Relative);
        using var getResponse = await client.GetAsync(roomUri);
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);

        // List -> the created room is present.
        using var listResponse = await client.GetAsync(roomsUri);
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        using var listDoc = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
        var listed = Assert.Single(listDoc.RootElement.EnumerateArray().ToList());
        Assert.Equal(roomId, listed.GetProperty("roomId").GetString());

        // Update -> 200 with the new name/sort order and a fresh ETag.
        using var updateRequest = new HttpRequestMessage(HttpMethod.Put, roomUri)
        {
            Content = JsonContent.Create(new { name = "Main Kitchen", sortOrder = 5 }),
        };
        updateRequest.Headers.TryAddWithoutValidation("If-Match", etag);
        using var updateResponse = await client.SendAsync(updateRequest);

        var updateBody = await updateResponse.Content.ReadAsStringAsync();
        Assert.True(updateResponse.StatusCode == HttpStatusCode.OK, updateBody);
        using var updateDoc = JsonDocument.Parse(updateBody);
        var updated = updateDoc.RootElement;
        Assert.Equal("Main Kitchen", updated.GetProperty("name").GetString());
        Assert.Equal(5, updated.GetProperty("sortOrder").GetInt32());
        Assert.NotEqual(etag, updated.GetProperty("eTag").GetString());

        // Delete -> 204, and the room is then gone.
        using var deleteResponse = await client.DeleteAsync(roomUri);
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        using var afterDelete = await client.GetAsync(roomUri);
        Assert.Equal(HttpStatusCode.NotFound, afterDelete.StatusCode);

        using var emptyList = await client.GetAsync(roomsUri);
        using var emptyDoc = JsonDocument.Parse(await emptyList.Content.ReadAsStringAsync());
        Assert.Empty(emptyDoc.RootElement.EnumerateArray().ToList());
    }
}
