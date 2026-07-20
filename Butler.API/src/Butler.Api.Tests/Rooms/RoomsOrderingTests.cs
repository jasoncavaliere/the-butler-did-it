using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Rooms;

/// <summary>
/// Criterion (H2): <c>GET /households/{householdId}/rooms</c> returns rooms
/// ordered by <c>SortOrder</c> ascending regardless of the order they were
/// created in - rooms are the physical map chores attach to, so their board order
/// is deterministic.
/// </summary>
public sealed class RoomsOrderingTests : IClassFixture<ButlerApiFactory>
{
    private static readonly string[] ExpectedOrder = ["Bedroom", "Living Room", "Garage"];

    private readonly ButlerApiFactory _factory;

    public RoomsOrderingTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task List_returns_rooms_ordered_by_sort_order_ascending()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var roomsUri = new Uri($"/households/{householdId}/rooms", UriKind.Relative);

        // Created deliberately out of order.
        await Create(client, roomsUri, "Garage", 30);
        await Create(client, roomsUri, "Bedroom", 10);
        await Create(client, roomsUri, "Living Room", 20);

        using var listResponse = await client.GetAsync(roomsUri);
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);

        using var doc = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
        var names = doc.RootElement.EnumerateArray()
            .Select(room => room.GetProperty("name").GetString())
            .ToList();

        Assert.Equal(ExpectedOrder, names);
    }

    private static async Task Create(HttpClient client, Uri roomsUri, string name, int sortOrder)
    {
        using var response = await client.PostAsJsonAsync(roomsUri, new { name, sortOrder });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }
}
