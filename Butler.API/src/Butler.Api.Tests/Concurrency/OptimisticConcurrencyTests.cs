using Butler.Api.Application.Concurrency;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Concurrency;

/// <summary>
/// Criterion (Engineering Contract 7.3): the shared optimistic-concurrency helper
/// enforces the ETag preconditions on every mutation - a missing <c>If-Match</c>
/// is <c>428</c>, a stale one is <c>412</c>, and a matching one succeeds. The
/// rules are asserted both directly on <see cref="OptimisticConcurrency"/> and
/// through the in-memory repository (the "faked table client") so the same rules
/// hold end to end.
/// </summary>
public sealed class OptimisticConcurrencyTests
{
    // --- The helper in isolation ------------------------------------------

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void RequireIfMatch_throws_428_when_missing(string? ifMatch)
    {
        Assert.Throws<PreconditionRequiredException>(() => OptimisticConcurrency.RequireIfMatch(ifMatch));
    }

    [Fact]
    public void RequireIfMatch_returns_the_value_when_present()
    {
        Assert.Equal("etag-1", OptimisticConcurrency.RequireIfMatch("etag-1"));
    }

    [Fact]
    public void EnsureCurrent_succeeds_when_the_etag_matches()
    {
        OptimisticConcurrency.EnsureCurrent(currentETag: "etag-1", ifMatch: "etag-1");
    }

    [Fact]
    public void EnsureCurrent_succeeds_for_the_wildcard()
    {
        OptimisticConcurrency.EnsureCurrent(currentETag: "etag-1", ifMatch: OptimisticConcurrency.Wildcard);
    }

    [Fact]
    public void EnsureCurrent_throws_412_when_the_etag_is_stale()
    {
        Assert.Throws<PreconditionFailedException>(
            () => OptimisticConcurrency.EnsureCurrent(currentETag: "etag-2", ifMatch: "etag-1"));
    }

    // --- The same rules through the in-memory repository ------------------

    [Fact]
    public async Task Update_without_if_match_is_428()
    {
        var repository = new InMemoryEntityRepository<FakeEntity>();
        var seeded = await Seed(repository, "house-1", "row-1");

        await Assert.ThrowsAsync<PreconditionRequiredException>(
            () => repository.UpdateAsync("house-1", seeded, ifMatch: null));
    }

    [Fact]
    public async Task Update_with_a_stale_if_match_is_412()
    {
        var repository = new InMemoryEntityRepository<FakeEntity>();
        var seeded = await Seed(repository, "house-1", "row-1");
        var staleETag = seeded.ETag.ToString();

        // Someone else updates first, moving the current ETag forward.
        await repository.UpdateAsync("house-1", seeded, seeded.ETag.ToString());

        var retry = new FakeEntity { RowKey = "row-1", Payload = "late" };
        await Assert.ThrowsAsync<PreconditionFailedException>(
            () => repository.UpdateAsync("house-1", retry, staleETag));
    }

    [Fact]
    public async Task Update_with_a_matching_if_match_succeeds()
    {
        var repository = new InMemoryEntityRepository<FakeEntity>();
        var seeded = await Seed(repository, "house-1", "row-1");

        var update = new FakeEntity { RowKey = "row-1", Payload = "updated" };
        await repository.UpdateAsync("house-1", update, seeded.ETag.ToString());

        var stored = await repository.GetAsync("house-1", "row-1");
        Assert.NotNull(stored);
        Assert.Equal("updated", stored!.Payload);
    }

    private static async Task<FakeEntity> Seed(
        InMemoryEntityRepository<FakeEntity> repository,
        string householdId,
        string rowKey)
    {
        var entity = new FakeEntity { RowKey = rowKey, Payload = "seed" };
        await repository.AddAsync(householdId, entity);
        var stored = await repository.GetAsync(householdId, rowKey);
        Assert.NotNull(stored);
        return stored!;
    }
}
