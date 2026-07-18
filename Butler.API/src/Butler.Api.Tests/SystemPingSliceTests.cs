using System.Net;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests;

/// <summary>
/// Criterion: the System feature is the reference vertical slice.
/// <c>GET /api/system/ping</c> must round-trip
/// HTTP -&gt; SystemController -&gt; MediatR -&gt; PingQueryHandler -&gt;
/// ISystemStatusProvider (Infrastructure) -&gt; SystemStatus (Domain). The
/// returned status/service originate from <c>SystemStatus.Healthy</c>, so
/// asserting them proves every layer of the slice participated.
/// </summary>
public sealed class SystemPingSliceTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public SystemPingSliceTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Get_ping_round_trips_the_full_layered_pipeline()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(new Uri("/api/system/ping", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        // These values are produced by the Domain (SystemStatus.Healthy) through
        // the Infrastructure provider and the MediatR handler.
        Assert.Equal("ok", root.GetProperty("status").GetString());
        Assert.Equal("Butler.API", root.GetProperty("service").GetString());

        // The handler stamps the response with the injected clock's time.
        Assert.True(
            root.TryGetProperty("timestampUtc", out var timestamp),
            "PingResult should carry a timestampUtc produced by the handler.");
        Assert.NotEqual(default, timestamp.GetDateTimeOffset());
    }
}
