using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Azure.Data.Tables;

namespace Butler.Api.SmokeTests;

/// <summary>
/// Criteria (#92 AC1-AC6): a real H1 entity (Rooms) round-trips through the
/// running API's HTTP endpoints against real Table Storage (Azurite) -
/// <c>POST</c> is <c>201</c>, <c>GET</c> is <c>200</c> with its <c>eTag</c>, a
/// <c>PUT</c> with the current <c>If-Match</c> is <c>200</c>, a <c>PUT</c> without
/// one is <c>428</c>, a <c>PUT</c> with a stale one is <c>412</c>, and
/// <c>DELETE</c> removes the room. Needs the API in Development at
/// <see cref="SmokeSettings.BaseUrl"/>, where the dev organizer bypass satisfies
/// the organizer policy.
/// </summary>
/// <remarks>
/// The class creates no table: the API provisions every feature table at
/// startup (#91), and <see cref="TableProvisioningSmokeTests"/> relies on no
/// smoke test creating one. It is mutating, so never point it at a deployed
/// environment; each test writes to its own <c>smoke-rooms-{guid}</c> partition
/// and every room it creates is deleted afterwards. It reads the Rooms table
/// directly to prove the API persisted to Table Storage, not to the in-memory
/// fallback.
/// </remarks>
[Trait(SmokeCategories.Name, SmokeCategories.Endpoints)]
public sealed class RoomsHttpRoundTripSmokeTests : IAsyncLifetime
{
    /// <summary>The table the Rooms feature registers (Application/Rooms/RoomsServiceCollectionExtensions.cs:22).</summary>
    private const string RoomsTable = "Rooms";

    private readonly string _householdId = "smoke-rooms-" + Guid.NewGuid().ToString("N");
    private readonly HttpClient _client = SmokeSettings.Current.CreateHttpClient();
    private readonly List<string> _createdRoomIds = [];

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        try
        {
            foreach (var roomId in _createdRoomIds)
            {
                try
                {
                    // A test that already deleted its room gets a 404 here; that is fine.
                    using var response = await _client.DeleteAsync(RoomUri(roomId));
                }
                catch (HttpRequestException)
                {
                    // The API is unreachable; the test itself has already failed.
                }
            }
        }
        finally
        {
            _client.Dispose();
        }
    }

    [Fact]
    public async Task Post_room_returns_201_and_persists_it_to_table_storage()
    {
        var created = await CreateRoomAsync("Smoke Kitchen", sortOrder: 1);

        Assert.False(string.IsNullOrWhiteSpace(created.RoomId), "POST must return a roomId.");

        var row = await ReadRoomRowAsync(created.RoomId);
        Assert.True(row is not null, $"The room was not written to the {RoomsTable} table.");
        Assert.Equal("Smoke Kitchen", row.GetString("Name"));
    }

    [Fact]
    public async Task Get_room_returns_200_with_its_etag()
    {
        var created = await CreateRoomAsync("Smoke Pantry", sortOrder: 3);

        var (status, room) = await GetRoomAsync(created.RoomId);

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.NotNull(room);
        Assert.Equal(created.RoomId, room.RoomId);
        Assert.Equal("Smoke Pantry", room.Name);
        Assert.Equal(3, room.SortOrder);
        Assert.False(string.IsNullOrWhiteSpace(room.ETag), "GET must return the room's eTag.");
        Assert.Equal(created.ETag, room.ETag);
    }

    [Fact]
    public async Task Put_room_with_current_etag_returns_200_and_get_returns_new_values()
    {
        var created = await CreateRoomAsync("Smoke Office", sortOrder: 1);
        var (_, current) = await GetRoomAsync(created.RoomId);
        Assert.NotNull(current);

        using var put = await PutAsync(created.RoomId, "Smoke Study", sortOrder: 2, ifMatch: current.ETag);
        var putBody = await put.Content.ReadAsStringAsync();
        Assert.True(put.StatusCode == HttpStatusCode.OK, putBody);
        var updated = ParseRoom(putBody);
        Assert.Equal("Smoke Study", updated.Name);
        Assert.Equal(2, updated.SortOrder);
        Assert.NotEqual(current.ETag, updated.ETag);

        var (status, reread) = await GetRoomAsync(created.RoomId);
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.NotNull(reread);
        Assert.Equal("Smoke Study", reread.Name);
        Assert.Equal(2, reread.SortOrder);
        Assert.Equal(updated.ETag, reread.ETag);
    }

    [Fact]
    public async Task Put_room_without_if_match_returns_428()
    {
        var created = await CreateRoomAsync("Smoke Garage", sortOrder: 1);

        using var put = await PutAsync(created.RoomId, "should-not-land", sortOrder: 9, ifMatch: null);
        Assert.True(
            put.StatusCode == HttpStatusCode.PreconditionRequired,
            $"Expected 428, got {(int)put.StatusCode}: {await put.Content.ReadAsStringAsync()}");

        var (_, after) = await GetRoomAsync(created.RoomId);
        Assert.NotNull(after);
        Assert.Equal("Smoke Garage", after.Name);
    }

    [Fact]
    public async Task Put_room_with_stale_etag_returns_412()
    {
        var created = await CreateRoomAsync("Smoke Laundry", sortOrder: 1);
        var staleETag = created.ETag;

        // A first writer wins with the current ETag, which makes it stale.
        using var first = await PutAsync(created.RoomId, "first-writer", sortOrder: 1, ifMatch: staleETag);
        Assert.True(first.StatusCode == HttpStatusCode.OK, await first.Content.ReadAsStringAsync());

        // A second writer still holding the original ETag is rejected.
        using var second = await PutAsync(created.RoomId, "second-writer", sortOrder: 1, ifMatch: staleETag);
        Assert.True(
            second.StatusCode == HttpStatusCode.PreconditionFailed,
            $"Expected 412, got {(int)second.StatusCode}: {await second.Content.ReadAsStringAsync()}");

        var (_, after) = await GetRoomAsync(created.RoomId);
        Assert.NotNull(after);
        Assert.Equal("first-writer", after.Name);
    }

    [Fact]
    public async Task Delete_room_returns_204_and_removes_it_from_table_storage()
    {
        var created = await CreateRoomAsync("Smoke Attic", sortOrder: 1);

        using var delete = await _client.DeleteAsync(RoomUri(created.RoomId));
        Assert.True(delete.StatusCode == HttpStatusCode.NoContent, await delete.Content.ReadAsStringAsync());

        var (status, _) = await GetRoomAsync(created.RoomId);
        Assert.Equal(HttpStatusCode.NotFound, status);

        Assert.Null(await ReadRoomRowAsync(created.RoomId));
    }

    private Uri RoomsUri() => new($"households/{_householdId}/rooms", UriKind.Relative);

    private Uri RoomUri(string roomId) => new($"households/{_householdId}/rooms/{roomId}", UriKind.Relative);

    private async Task<Room> CreateRoomAsync(string name, int sortOrder)
    {
        using var response = await _client.PostAsJsonAsync(RoomsUri(), new { name, sortOrder });
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Created, $"Expected 201, got {(int)response.StatusCode}: {body}");

        var room = ParseRoom(body);
        _createdRoomIds.Add(room.RoomId);
        return room;
    }

    private async Task<(HttpStatusCode Status, Room? Room)> GetRoomAsync(string roomId)
    {
        using var response = await _client.GetAsync(RoomUri(roomId));
        if (response.StatusCode != HttpStatusCode.OK)
        {
            return (response.StatusCode, null);
        }

        return (response.StatusCode, ParseRoom(await response.Content.ReadAsStringAsync()));
    }

    private async Task<HttpResponseMessage> PutAsync(string roomId, string name, int sortOrder, string? ifMatch)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, RoomUri(roomId))
        {
            Content = JsonContent.Create(new { name, sortOrder }),
        };
        if (ifMatch is not null)
        {
            // Sent exactly as the API returned it; Azurite ETags (W/"datetime'...'")
            // would be rejected or reformatted by EntityTagHeaderValue.
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        }

        return await _client.SendAsync(request);
    }

    /// <summary>Reads the room's row straight from the Rooms table; never creates the table.</summary>
    private async Task<TableEntity?> ReadRoomRowAsync(string roomId)
    {
        var table = new TableClient(SmokeSettings.Current.StorageConnectionString, RoomsTable);
        var response = await table.GetEntityIfExistsAsync<TableEntity>(_householdId, roomId);
        return response.HasValue ? response.Value : null;
    }

    private static Room ParseRoom(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        return new Room(
            root.GetProperty("roomId").GetString() ?? string.Empty,
            root.GetProperty("name").GetString() ?? string.Empty,
            root.GetProperty("sortOrder").GetInt32(),
            root.GetProperty("eTag").GetString() ?? string.Empty);
    }

    private sealed record Room(string RoomId, string Name, int SortOrder, string ETag);
}
