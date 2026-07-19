using Butler.Api.Application.Concurrency;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Storage;

/// <summary>
/// Criterion: the in-memory seed/fallback store implements the same seam as the
/// Table-backed one - entity CRUD scoped by <c>PartitionKey = householdId</c>
/// with optimistic concurrency - so the API and tests run with no Azurite while
/// behaving like real storage (Engineering Contract 7.3).
/// </summary>
public sealed class InMemoryEntityRepositoryTests
{
    private readonly InMemoryEntityRepository<FakeEntity> _repository = new();

    [Fact]
    public async Task Add_then_get_round_trips_and_scopes_the_partition_key()
    {
        await _repository.AddAsync("house-1", new FakeEntity { RowKey = "row-1", Payload = "hello" });

        var stored = await _repository.GetAsync("house-1", "row-1");

        Assert.NotNull(stored);
        Assert.Equal("house-1", stored!.PartitionKey);
        Assert.Equal("hello", stored.Payload);
        Assert.NotEqual(default, stored.ETag);
    }

    [Fact]
    public async Task Get_returns_null_for_a_missing_row()
    {
        Assert.Null(await _repository.GetAsync("house-1", "absent"));
    }

    [Fact]
    public async Task Reads_and_writes_are_isolated_by_household()
    {
        await _repository.AddAsync("house-1", new FakeEntity { RowKey = "row-1", Payload = "one" });
        await _repository.AddAsync("house-2", new FakeEntity { RowKey = "row-1", Payload = "two" });

        var listOne = await _repository.ListAsync("house-1");

        Assert.Single(listOne);
        Assert.Equal("one", listOne[0].Payload);
        // Same row key, different household, is a different entity.
        Assert.Null(await _repository.GetAsync("house-1", "row-2"));
        Assert.Equal("two", (await _repository.GetAsync("house-2", "row-1"))!.Payload);
    }

    [Fact]
    public async Task Add_rejects_a_duplicate_row_in_the_same_household()
    {
        await _repository.AddAsync("house-1", new FakeEntity { RowKey = "row-1" });

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => _repository.AddAsync("house-1", new FakeEntity { RowKey = "row-1" }));
    }

    [Fact]
    public async Task Upsert_inserts_and_then_replaces_without_a_concurrency_check()
    {
        await _repository.UpsertAsync("house-1", new FakeEntity { RowKey = "row-1", Payload = "first" });
        await _repository.UpsertAsync("house-1", new FakeEntity { RowKey = "row-1", Payload = "second" });

        Assert.Equal("second", (await _repository.GetAsync("house-1", "row-1"))!.Payload);
    }

    [Fact]
    public async Task Update_on_a_missing_entity_is_412()
    {
        await Assert.ThrowsAsync<PreconditionFailedException>(
            () => _repository.UpdateAsync("house-1", new FakeEntity { RowKey = "ghost" }, ifMatch: "*"));
    }

    [Fact]
    public async Task Delete_removes_under_a_matching_if_match()
    {
        await _repository.AddAsync("house-1", new FakeEntity { RowKey = "row-1" });
        var stored = await _repository.GetAsync("house-1", "row-1");

        await _repository.DeleteAsync("house-1", "row-1", stored!.ETag.ToString());

        Assert.Null(await _repository.GetAsync("house-1", "row-1"));
    }

    [Fact]
    public async Task Delete_without_an_if_match_is_428()
    {
        await _repository.AddAsync("house-1", new FakeEntity { RowKey = "row-1" });

        await Assert.ThrowsAsync<PreconditionRequiredException>(
            () => _repository.DeleteAsync("house-1", "row-1", ifMatch: null));
    }

    [Fact]
    public async Task Delete_with_a_stale_if_match_is_412()
    {
        await _repository.AddAsync("house-1", new FakeEntity { RowKey = "row-1" });

        await Assert.ThrowsAsync<PreconditionFailedException>(
            () => _repository.DeleteAsync("house-1", "row-1", ifMatch: "stale-etag"));
    }

    [Fact]
    public async Task Delete_on_a_missing_entity_is_412()
    {
        await Assert.ThrowsAsync<PreconditionFailedException>(
            () => _repository.DeleteAsync("house-1", "ghost", ifMatch: "*"));
    }
}
