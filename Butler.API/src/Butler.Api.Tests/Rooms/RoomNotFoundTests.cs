using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Rooms;

/// <summary>
/// Criterion (H2): an unknown <c>roomId</c> (or a room in an unknown household)
/// returns <c>404</c> as an RFC 7807 problem details document on the single-read,
/// update, and delete endpoints (Engineering Contract 7.5).
/// </summary>
public sealed class RoomNotFoundTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public RoomNotFoundTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Get_unknown_room_returns_404_problem_details()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(UnknownRoomUri());

        await AssertRoomNotFound(response);
    }

    [Fact]
    public async Task Update_unknown_room_returns_404_problem_details()
    {
        using var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Put, UnknownRoomUri())
        {
            Content = JsonContent.Create(new { name = "Ghost", sortOrder = 1 }),
        };
        request.Headers.TryAddWithoutValidation("If-Match", "*");
        using var response = await client.SendAsync(request);

        await AssertRoomNotFound(response);
    }

    [Fact]
    public async Task Delete_unknown_room_returns_404_problem_details()
    {
        using var client = _factory.CreateClient();

        using var response = await client.DeleteAsync(UnknownRoomUri());

        await AssertRoomNotFound(response);
    }

    private static Uri UnknownRoomUri()
    {
        var householdId = Guid.NewGuid().ToString("N");
        return new Uri($"/households/{householdId}/rooms/does-not-exist", UriKind.Relative);
    }

    private static async Task AssertRoomNotFound(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        Assert.Equal(404, root.GetProperty("status").GetInt32());
        Assert.Equal("Room not found.", root.GetProperty("title").GetString());
    }
}
