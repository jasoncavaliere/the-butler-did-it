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

    // ---- SubmitBatchAsync: validate everything, then apply everything (#319) ----

    private static EntityBatchOperation<FakeEntity> Add(string rowKey, string payload = "new") =>
        new(EntityBatchOperationKind.Add, new FakeEntity { RowKey = rowKey, Payload = payload });

    private static EntityBatchOperation<FakeEntity> Update(string rowKey, string? ifMatch, string payload = "replaced") =>
        new(EntityBatchOperationKind.Update, new FakeEntity { RowKey = rowKey, Payload = payload }, ifMatch);

    // RowKey -> Payload, captured now: the store hands out live references.
    private async Task<Dictionary<string, string>> SnapshotAsync(string householdId = "house-1") =>
        (await _repository.ListAsync(householdId)).ToDictionary(row => row.RowKey, row => row.Payload);

    private async Task<string> SeedAsync(string rowKey, string payload = "old")
    {
        await _repository.AddAsync("house-1", new FakeEntity { RowKey = rowKey, Payload = payload });
        return (await _repository.GetAsync("house-1", rowKey))!.ETag.ToString();
    }

    [Fact]
    public async Task Batch_applies_every_add_and_update_together()
    {
        var etag = await SeedAsync("row-1");
        await SeedAsync("row-2");

        await _repository.SubmitBatchAsync(
            "house-1",
            [Add("row-3"), Update("row-1", etag), Update("row-2", OptimisticConcurrency.Wildcard)]);

        Assert.Equal(
            new Dictionary<string, string> { ["row-1"] = "replaced", ["row-2"] = "replaced", ["row-3"] = "new" },
            await SnapshotAsync());
        var added = (await _repository.GetAsync("house-1", "row-3"))!;
        Assert.Equal("house-1", added.PartitionKey);
        Assert.NotEqual(default, added.ETag);
        Assert.NotEqual(etag, (await _repository.GetAsync("house-1", "row-1"))!.ETag.ToString());
    }

    [Fact]
    public async Task Batch_with_a_conflicting_add_writes_nothing()
    {
        await SeedAsync("row-c");

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => _repository.SubmitBatchAsync("house-1", [Add("row-a"), Add("row-b"), Add("row-c")]));

        Assert.Equal(new Dictionary<string, string> { ["row-c"] = "old" }, await SnapshotAsync());
    }

    [Fact]
    public async Task Batch_with_a_duplicate_row_key_writes_nothing()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => _repository.SubmitBatchAsync("house-1", [Add("row-a"), Add("row-a", "again")]));

        Assert.Empty(await SnapshotAsync());
    }

    [Fact]
    public async Task Batch_updating_a_missing_row_is_412_and_writes_nothing()
    {
        await Assert.ThrowsAsync<PreconditionFailedException>(
            () => _repository.SubmitBatchAsync("house-1", [Add("row-a"), Update("ghost", "*")]));

        Assert.Empty(await SnapshotAsync());
    }

    [Fact]
    public async Task Batch_with_a_stale_etag_is_412_and_writes_nothing()
    {
        await SeedAsync("row-1");

        await Assert.ThrowsAsync<PreconditionFailedException>(
            () => _repository.SubmitBatchAsync("house-1", [Add("row-a"), Update("row-1", "stale-etag")]));

        Assert.Equal(new Dictionary<string, string> { ["row-1"] = "old" }, await SnapshotAsync());
    }

    [Fact]
    public async Task Batch_update_without_an_if_match_is_428_and_writes_nothing()
    {
        await SeedAsync("row-1");

        await Assert.ThrowsAsync<PreconditionRequiredException>(
            () => _repository.SubmitBatchAsync("house-1", [Add("row-a"), Update("row-1", ifMatch: null)]));

        Assert.Equal(new Dictionary<string, string> { ["row-1"] = "old" }, await SnapshotAsync());
    }

    [Fact]
    public async Task Batch_with_no_operations_is_a_no_op()
    {
        await SeedAsync("row-1");

        await _repository.SubmitBatchAsync("house-1", []);

        Assert.Equal(new Dictionary<string, string> { ["row-1"] = "old" }, await SnapshotAsync());
    }

    [Fact]
    public async Task Batch_with_a_cancelled_token_writes_nothing()
    {
        using var cancellation = new CancellationTokenSource();
        await cancellation.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => _repository.SubmitBatchAsync("house-1", [Add("row-a")], cancellation.Token));

        Assert.Empty(await SnapshotAsync());
    }

    [Fact]
    public async Task Batch_rejects_a_blank_household_null_operations_and_blank_row_keys()
    {
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => _repository.SubmitBatchAsync(" ", [Add("row-a")]));
        await Assert.ThrowsAsync<ArgumentNullException>(
            () => _repository.SubmitBatchAsync("house-1", null!));
        await Assert.ThrowsAsync<ArgumentNullException>(
            () => _repository.SubmitBatchAsync("house-1", [null!]));
        await Assert.ThrowsAsync<ArgumentNullException>(
            () => _repository.SubmitBatchAsync(
                "house-1", [new EntityBatchOperation<FakeEntity>(EntityBatchOperationKind.Add, null!)]));
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => _repository.SubmitBatchAsync("house-1", [Add(" ")]));

        Assert.Empty(await SnapshotAsync());
    }

    [Fact]
    public async Task Batch_is_isolated_by_household()
    {
        await _repository.AddAsync("house-2", new FakeEntity { RowKey = "row-1", Payload = "two" });

        await _repository.SubmitBatchAsync("house-1", [Add("row-1")]);

        Assert.Equal(new Dictionary<string, string> { ["row-1"] = "new" }, await SnapshotAsync());
        Assert.Equal(new Dictionary<string, string> { ["row-1"] = "two" }, await SnapshotAsync("house-2"));
    }
}
