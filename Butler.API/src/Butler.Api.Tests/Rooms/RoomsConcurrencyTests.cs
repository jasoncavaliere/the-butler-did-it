using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Rooms;

/// <summary>
/// Criterion (H2 / Engineering Contract 7.3): <c>PUT</c> on a room enforces the
/// shared optimistic-concurrency rules - a missing <c>If-Match</c> is <c>428</c>,
/// a stale one is <c>412</c>, and a matching one succeeds.
/// </summary>
public sealed class RoomsConcurrencyTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public RoomsConcurrencyTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Update_enforces_if_match_precondition()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var roomsUri = new Uri($"/households/{householdId}/rooms", UriKind.Relative);

        using var createResponse = await client.PostAsJsonAsync(
            roomsUri,
            new { name = "Office", sortOrder = 1 });
        using var createDoc = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        var roomId = createDoc.RootElement.GetProperty("roomId").GetString();
        var originalETag = createDoc.RootElement.GetProperty("eTag").GetString();
        var roomUri = new Uri($"/households/{householdId}/rooms/{roomId}", UriKind.Relative);

        // Missing If-Match -> 428 Precondition Required.
        using var noHeader = await client.SendAsync(Put(roomUri, ifMatch: null));
        Assert.Equal(HttpStatusCode.PreconditionRequired, noHeader.StatusCode);

        // Matching If-Match -> success, ETag advances.
        using var matched = await client.SendAsync(Put(roomUri, ifMatch: originalETag));
        Assert.Equal(HttpStatusCode.OK, matched.StatusCode);
        using var matchedDoc = JsonDocument.Parse(await matched.Content.ReadAsStringAsync());
        var newETag = matchedDoc.RootElement.GetProperty("eTag").GetString();
        Assert.NotEqual(originalETag, newETag);

        // Re-using the now-stale original ETag -> 412 Precondition Failed.
        using var stale = await client.SendAsync(Put(roomUri, ifMatch: originalETag));
        Assert.Equal(HttpStatusCode.PreconditionFailed, stale.StatusCode);
    }

    private static HttpRequestMessage Put(Uri roomUri, string? ifMatch)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, roomUri)
        {
            Content = JsonContent.Create(new { name = "Office (renamed)", sortOrder = 2 }),
        };
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        }

        return request;
    }
}
