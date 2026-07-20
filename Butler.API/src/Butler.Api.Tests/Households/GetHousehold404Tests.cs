using System.Net;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Households;

/// <summary>
/// Criterion (H1): <c>GET /households/{householdId}</c> for an unknown id returns
/// <c>404</c> as an RFC 7807 problem details document (Engineering Contract 7.5).
/// </summary>
public sealed class GetHousehold404Tests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public GetHousehold404Tests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Get_unknown_household_returns_404_problem_details()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(
            new Uri("/households/does-not-exist", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        Assert.Equal(404, root.GetProperty("status").GetInt32());
        Assert.Equal("Household not found.", root.GetProperty("title").GetString());
    }
}
