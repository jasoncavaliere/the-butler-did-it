using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.TapToClaim;

/// <summary>
/// Criterion (T1): a claim can only mint a session for a person actually on the
/// roster. Claiming a person that does not exist - or a person in a household that
/// does not exist - is a <c>404</c> as RFC 7807 problem details, never a session.
/// </summary>
public sealed class ClaimUnknownPersonReturns404Tests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public ClaimUnknownPersonReturns404Tests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Claiming_an_unknown_person_in_an_existing_household_is_404()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");

        // Seed one person so the household partition exists, then claim a different id.
        using var createResponse = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/people", UriKind.Relative),
            new { displayName = "Sam", role = "Participant", isChild = false, claimColor = (string?)null });
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);

        using var claim = await client.PostAsync(
            new Uri($"/households/{householdId}/people/does-not-exist/claim", UriKind.Relative),
            content: null);

        Assert.Equal(HttpStatusCode.NotFound, claim.StatusCode);
        await AssertProblemDetails(claim);
    }

    [Fact]
    public async Task Claiming_in_an_unknown_household_is_404()
    {
        using var client = _factory.CreateClient();
        var unknownHousehold = Guid.NewGuid().ToString("N");

        using var claim = await client.PostAsync(
            new Uri($"/households/{unknownHousehold}/people/anybody/claim", UriKind.Relative),
            content: null);

        Assert.Equal(HttpStatusCode.NotFound, claim.StatusCode);
        await AssertProblemDetails(claim);
    }

    private static async Task AssertProblemDetails(HttpResponseMessage response)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(404, doc.RootElement.GetProperty("status").GetInt32());
    }
}
