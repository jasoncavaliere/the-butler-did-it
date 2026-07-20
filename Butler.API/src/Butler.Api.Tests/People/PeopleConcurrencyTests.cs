using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.People;

/// <summary>
/// Criterion (H3 / Engineering Contract 7.3): <c>PUT</c> on a person enforces the
/// shared optimistic-concurrency rules - a missing <c>If-Match</c> is <c>428</c>,
/// a stale one is <c>412</c>, and a matching one succeeds.
/// </summary>
public sealed class PeopleConcurrencyTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public PeopleConcurrencyTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task PeopleConcurrency()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var peopleUri = new Uri($"/households/{householdId}/people", UriKind.Relative);

        using var createResponse = await client.PostAsJsonAsync(
            peopleUri,
            new { displayName = "Robin", role = "Participant", isChild = false, claimColor = (string?)null });
        using var createDoc = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        var personId = createDoc.RootElement.GetProperty("personId").GetString();
        var originalETag = createDoc.RootElement.GetProperty("eTag").GetString();
        var personUri = new Uri($"/households/{householdId}/people/{personId}", UriKind.Relative);

        // Missing If-Match -> 428 Precondition Required.
        using var noHeader = await client.SendAsync(Put(personUri, ifMatch: null));
        Assert.Equal(HttpStatusCode.PreconditionRequired, noHeader.StatusCode);

        // Matching If-Match -> success, ETag advances.
        using var matched = await client.SendAsync(Put(personUri, ifMatch: originalETag));
        Assert.Equal(HttpStatusCode.OK, matched.StatusCode);
        using var matchedDoc = JsonDocument.Parse(await matched.Content.ReadAsStringAsync());
        var newETag = matchedDoc.RootElement.GetProperty("eTag").GetString();
        Assert.NotEqual(originalETag, newETag);

        // Re-using the now-stale original ETag -> 412 Precondition Failed.
        using var stale = await client.SendAsync(Put(personUri, ifMatch: originalETag));
        Assert.Equal(HttpStatusCode.PreconditionFailed, stale.StatusCode);
    }

    private static HttpRequestMessage Put(Uri personUri, string? ifMatch)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, personUri)
        {
            Content = JsonContent.Create(
                new { displayName = "Robin (renamed)", role = "Participant", isChild = false, claimColor = (string?)null }),
        };
        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        }

        return request;
    }
}
