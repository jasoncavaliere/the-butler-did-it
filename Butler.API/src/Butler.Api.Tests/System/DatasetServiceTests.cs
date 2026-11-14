using Butler.Api.Application.System;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Infrastructure.System;
using Butler.Api.Tests.TestSupport;
using NSubstitute;

namespace Butler.Api.Tests.System;

/// <summary>
/// Unit tests for <see cref="DatasetService"/> over the in-memory store
/// (#100 AC2, AC3): a missing id is minted and persisted once, later reads
/// return it, a regenerate replaces it, and concurrent first reads agree.
/// </summary>
public sealed class DatasetServiceTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);

    private readonly InMemoryEntityRepository<DatasetEntity> _store = new();
    private readonly DatasetService _service;

    public DatasetServiceTests()
    {
        _service = new DatasetService(new TableDatasetRepository(_store), new MutableClock(Now));
    }

    public void Dispose() => _service.Dispose();

    [Fact]
    public async Task GetOrCreate_creates_and_persists_an_id_when_none_is_stored()
    {
        var id = await _service.GetOrCreateAsync();

        Assert.Matches("^[0-9a-f]{32}$", id);
        var stored = await _store.GetAsync(DatasetEntity.Partition, DatasetEntity.Row);
        Assert.NotNull(stored);
        Assert.Equal(id, stored.DatasetId);
    }

    [Fact]
    public async Task GetOrCreate_returns_the_stored_id_on_later_calls()
    {
        var first = await _service.GetOrCreateAsync();

        Assert.Equal(first, await _service.GetOrCreateAsync());
        Assert.Single(await _store.ListAsync(DatasetEntity.Partition));
    }

    [Fact]
    public async Task GetOrCreate_replaces_a_stored_row_that_has_no_id()
    {
        await _store.AddAsync(
            DatasetEntity.Partition,
            new DatasetEntity { RowKey = DatasetEntity.Row, DatasetId = " " });

        var id = await _service.GetOrCreateAsync();

        Assert.False(string.IsNullOrWhiteSpace(id));
        var stored = await _store.GetAsync(DatasetEntity.Partition, DatasetEntity.Row);
        Assert.Equal(id, stored?.DatasetId);
    }

    [Fact]
    public async Task Concurrent_first_reads_return_one_id()
    {
        var reads = Enumerable.Range(0, 16).Select(_ => Task.Run(() => _service.GetOrCreateAsync()));

        var ids = await Task.WhenAll(reads);

        Assert.Single(ids.Distinct(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Created_row_is_stamped_from_the_injected_clock()
    {
        await _service.GetOrCreateAsync();

        var stored = await _store.GetAsync(DatasetEntity.Partition, DatasetEntity.Row);
        Assert.Equal(Now, stored?.CreatedUtc);
    }

    [Fact]
    public async Task Regenerate_replaces_the_stored_id()
    {
        var original = await _service.GetOrCreateAsync();

        var regenerated = await _service.RegenerateAsync();

        Assert.NotEqual(original, regenerated);
        Assert.Equal(regenerated, await _service.GetOrCreateAsync());
    }

    [Fact]
    public async Task Regenerate_works_when_no_id_is_stored()
    {
        var regenerated = await _service.RegenerateAsync();

        Assert.Equal(regenerated, await _service.GetOrCreateAsync());
    }

    [Fact]
    public async Task A_failed_write_releases_the_lock()
    {
        var repository = Substitute.For<IDatasetRepository>();
        repository.GetAsync(Arg.Any<CancellationToken>()).Returns((DatasetEntity?)null);
        repository.AddAsync(Arg.Any<DatasetEntity>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromException(new InvalidOperationException("boom")));
        repository.UpsertAsync(Arg.Any<DatasetEntity>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromException(new InvalidOperationException("boom")));
        using var service = new DatasetService(repository, TimeProvider.System);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.GetOrCreateAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.RegenerateAsync());
        // Neither failure left the lock held, so a third call still reaches the store.
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.GetOrCreateAsync());
    }

    [Fact]
    public void Service_guards_its_arguments()
    {
        var repository = Substitute.For<IDatasetRepository>();

        Assert.Throws<ArgumentNullException>(() => new DatasetService(null!, TimeProvider.System));
        Assert.Throws<ArgumentNullException>(() => new DatasetService(repository, null!));
    }
}
