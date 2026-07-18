using System.Net;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests;

/// <summary>
/// Criterion: <c>GET /health</c> returns <c>200</c> with body
/// <c>{ "status": "ok" }</c> (liveness preserved, outside the MediatR pipeline).
/// </summary>
public sealed class HealthEndpointTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public HealthEndpointTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Get_health_returns_200_with_status_ok()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(new Uri("/health", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("ok", doc.RootElement.GetProperty("status").GetString());
    }
}
