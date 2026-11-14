using System.Net;
using System.Text.Json;
using Butler.Api.Tests.Demo;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.System;

/// <summary>
/// Criteria (#100 AC1, AC3): <c>GET /api/system/dataset</c> returns the
/// deployment's dataset id, uncached and stable across reads, and a demo reseed
/// through <c>POST /demo/seed</c> replaces it. Each test builds its own factory,
/// because the in-memory store is per factory and a reseed mutates it.
/// </summary>
public sealed class DatasetEndpointTests
{
    private static readonly Uri DatasetUri = new("/api/system/dataset", UriKind.Relative);

    [Fact]
    public async Task Get_dataset_returns_200_with_a_non_empty_dataset_id()
    {
        using var factory = new ButlerApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(DatasetUri);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore, "The dataset id must never be cached.");
        var first = await ReadIdAsync(response);
        Assert.False(string.IsNullOrWhiteSpace(first));

        // A second read returns the same id: it only changes on a reseed.
        using var again = await client.GetAsync(DatasetUri);
        Assert.Equal(first, await ReadIdAsync(again));
    }

    [Fact]
    public async Task Reseeding_changes_the_dataset_id()
    {
        using var factory = DemoTestHost.CreateFactory(new MutableClock(DemoTestHost.MidJuly));
        using var client = factory.CreateClient();

        using var before = await client.GetAsync(DatasetUri);
        var original = await ReadIdAsync(before);

        using var seed = await client.PostAsync(new Uri("/demo/seed", UriKind.Relative), content: null);
        Assert.Equal(HttpStatusCode.OK, seed.StatusCode);

        using var after = await client.GetAsync(DatasetUri);
        var reseeded = await ReadIdAsync(after);
        Assert.False(string.IsNullOrWhiteSpace(reseeded));
        Assert.NotEqual(original, reseeded);
    }

    private static async Task<string?> ReadIdAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("datasetId").GetString();
    }
}
