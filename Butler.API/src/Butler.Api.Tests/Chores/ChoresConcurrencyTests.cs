using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Chores;

/// <summary>
/// Criterion (H4 / Engineering Contract 7.3): <c>PUT</c> on a chore enforces the
/// shared optimistic-concurrency rules - a missing <c>If-Match</c> is <c>428</c>,
/// a stale one is <c>412</c>, and a matching one succeeds.
/// </summary>
public sealed class ChoresConcurrencyTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public ChoresConcurrencyTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Update_enforces_if_match_precondition()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var roomId = await ChoreTestHelper.CreateRoomAsync(client, householdId, "Kitchen", 1);
        var (choreId, originalETag) = await ChoreTestHelper.CreateChoreAsync(client, householdId, roomId);
        var choreUri = new Uri($"/households/{householdId}/chores/{choreId}", UriKind.Relative);

        // Missing If-Match -> 428 Precondition Required.
        using var noHeader = await client.SendAsync(Put(choreUri, roomId, ifMatch: null));
        Assert.Equal(HttpStatusCode.PreconditionRequired, noHeader.StatusCode);

        // Matching If-Match -> success, ETag advances.
        using var matched = await client.SendAsync(Put(choreUri, roomId, ifMatch: originalETag));
        Assert.Equal(HttpStatusCode.OK, matched.StatusCode);
        using var matchedDoc = JsonDocument.Parse(await matched.Content.ReadAsStringAsync());
        var newETag = matchedDoc.RootElement.GetProperty("eTag").GetString();
        Assert.NotEqual(originalETag, newETag);

        // Re-using the now-stale original ETag -> 412 Precondition Failed.
        using var stale = await client.SendAsync(Put(choreUri, roomId, ifMatch: originalETag));
        Assert.Equal(HttpStatusCode.PreconditionFailed, stale.StatusCode);
    }

    private static HttpRequestMessage Put(Uri choreUri, string roomId, string? ifMatch)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, choreUri)
        {
            Content = JsonContent.Create(
                new { title = "Dishes (renamed)", roomId, cadence = "Weekly", effort = 4, minAge = (int?)null, active = true }),
        };
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        }

        return request;
    }
}
