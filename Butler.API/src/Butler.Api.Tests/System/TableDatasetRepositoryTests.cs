using Butler.Api.Infrastructure.Storage;
using Butler.Api.Infrastructure.System;

namespace Butler.Api.Tests.System;

/// <summary>
/// Unit tests for <see cref="TableDatasetRepository"/> over the in-memory store
/// (#100 AC2): every operation addresses the single reserved
/// <c>_system</c>/<c>dataset</c> row.
/// </summary>
public sealed class TableDatasetRepositoryTests
{
    [Fact]
    public async Task Repository_reads_and_writes_the_single_system_row()
    {
        var store = new InMemoryEntityRepository<DatasetEntity>();
        var repository = new TableDatasetRepository(store);

        Assert.Null(await repository.GetAsync());

        await repository.AddAsync(new DatasetEntity { DatasetId = "first" });
        var added = await store.GetAsync(DatasetEntity.Partition, DatasetEntity.Row);
        Assert.NotNull(added);
        Assert.Equal("first", added.DatasetId);

        // Add never replaces: a second add of the same row fails.
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => repository.AddAsync(new DatasetEntity { DatasetId = "second" }));

        await repository.UpsertAsync(new DatasetEntity { DatasetId = "replaced" });
        var read = await repository.GetAsync();
        Assert.NotNull(read);
        Assert.Equal("replaced", read.DatasetId);
        Assert.Equal(DatasetEntity.Partition, read.PartitionKey);
        Assert.Equal(DatasetEntity.Row, read.RowKey);
        Assert.Single(await store.ListAsync(DatasetEntity.Partition));
    }

    [Fact]
    public void Entity_carries_the_table_metadata()
    {
        var stamp = new DateTimeOffset(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);
        var entity = new DatasetEntity { Timestamp = stamp, ETag = new Azure.ETag("W/\"1\"") };

        Assert.Equal(stamp, entity.Timestamp);
        Assert.Equal("W/\"1\"", entity.ETag.ToString());
        Assert.Equal("Datasets", DatasetEntity.TableName);
    }

    [Fact]
    public async Task Repository_guards_its_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => new TableDatasetRepository(null!));

        var repository = new TableDatasetRepository(new InMemoryEntityRepository<DatasetEntity>());
        await Assert.ThrowsAsync<ArgumentNullException>(() => repository.AddAsync(null!));
        await Assert.ThrowsAsync<ArgumentNullException>(() => repository.UpsertAsync(null!));
    }
}
