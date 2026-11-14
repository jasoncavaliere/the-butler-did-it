using System.Net;
using System.Reflection;
using System.Text.Json;
using Butler.Api.Infrastructure.System;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.System;

/// <summary>
/// Criteria (#126 AC1, AC2): <c>GET /api/system/version</c> returns 200 with
/// <c>{ sha, buildTime }</c>, uncached and anonymous. A stamped build reports
/// its SHA and UTC build time; an unstamped build reports <c>"dev"</c> instead
/// of failing. Exact values come from an injected provider, because the real
/// test build may or may not carry a stamp.
/// </summary>
public sealed class VersionEndpointTests
{
    private static readonly Uri VersionUri = new("/api/system/version", UriKind.Relative);

    [Fact]
    public async Task Get_version_returns_the_stamped_sha_and_utc_build_time()
    {
        using var factory = FactoryWith(
            new AssemblyMetadataAttribute(AssemblyBuildVersionProvider.ShaKey, "abc1234"),
            new AssemblyMetadataAttribute(AssemblyBuildVersionProvider.BuildTimeKey, "2026-11-14T10:00:00Z"));
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(VersionUri);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore, "The version must never be cached.");
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("abc1234", doc.RootElement.GetProperty("sha").GetString());
        Assert.Equal("2026-11-14T10:00:00Z", doc.RootElement.GetProperty("buildTime").GetString());
    }

    [Fact]
    public async Task Get_version_returns_dev_when_the_build_carries_no_stamp()
    {
        using var factory = FactoryWith();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(VersionUri);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("dev", doc.RootElement.GetProperty("sha").GetString());
        Assert.Equal(JsonValueKind.Null, doc.RootElement.GetProperty("buildTime").ValueKind);
    }

    [Fact]
    public async Task Get_version_with_the_real_registration_returns_200_and_a_sha()
    {
        using var factory = new ButlerApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(VersionUri);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore, "The version must never be cached.");
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.False(string.IsNullOrWhiteSpace(doc.RootElement.GetProperty("sha").GetString()));
    }

    private static WebApplicationFactory<Program> FactoryWith(params AssemblyMetadataAttribute[] metadata) =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
                services.AddSingleton<IBuildVersionProvider>(new AssemblyBuildVersionProvider(metadata))));
}
