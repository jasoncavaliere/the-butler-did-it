using System.Net;
using System.Text.Json;

namespace Butler.Api.SmokeTests;

/// <summary>
/// Criterion (AC3/AC4): a running API answers its anonymous liveness probes.
/// These send real HTTP to <see cref="SmokeSettings.BaseUrl"/> (no in-process
/// host), and are read-only - so they are the one category that is safe to point
/// at a deployed environment. An unreachable API fails the test; it never skips.
/// </summary>
[Trait(SmokeCategories.Name, SmokeCategories.Liveness)]
public sealed class LivenessSmokeTests
{
    [Fact]
    public async Task Get_health_returns_200_with_status_ok()
    {
        using var client = SmokeSettings.Current.CreateHttpClient();

        using var response = await client.GetAsync(new Uri("health", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("ok", doc.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Get_ping_returns_200_with_service_identity()
    {
        using var client = SmokeSettings.Current.CreateHttpClient();

        using var response = await client.GetAsync(new Uri("api/system/ping", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        Assert.Equal("ok", root.GetProperty("status").GetString());
        Assert.Equal("Butler.API", root.GetProperty("service").GetString());
        Assert.True(
            root.TryGetProperty("timestampUtc", out var timestamp),
            "The ping payload should carry a timestampUtc.");
        Assert.True(
            timestamp.TryGetDateTimeOffset(out var stamped) && stamped != default,
            $"timestampUtc should be a valid, non-default timestamp; got '{timestamp}'.");
    }
}
