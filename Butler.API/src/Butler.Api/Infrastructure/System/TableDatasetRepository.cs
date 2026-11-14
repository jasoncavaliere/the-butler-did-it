using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Infrastructure.System;

/// <summary>
/// <see cref="IDatasetRepository"/> on the shared F3 Table access seam
/// (<see cref="IEntityRepository{TEntity}"/>). The "household" argument of the
/// generic repository is always the reserved <see cref="DatasetEntity.Partition"/>
/// and the row key is always <see cref="DatasetEntity.Row"/>.
/// </summary>
public sealed class TableDatasetRepository : IDatasetRepository
{
    private readonly IEntityRepository<DatasetEntity> _datasets;

    public TableDatasetRepository(IEntityRepository<DatasetEntity> datasets)
    {
        ArgumentNullException.ThrowIfNull(datasets);
        _datasets = datasets;
    }

    /// <inheritdoc />
    public Task<DatasetEntity?> GetAsync(CancellationToken cancellationToken = default) =>
        _datasets.GetAsync(DatasetEntity.Partition, DatasetEntity.Row, cancellationToken);

    /// <inheritdoc />
    public Task AddAsync(DatasetEntity dataset, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(dataset);
        dataset.RowKey = DatasetEntity.Row;
        return _datasets.AddAsync(DatasetEntity.Partition, dataset, cancellationToken);
    }

    /// <inheritdoc />
    public Task UpsertAsync(DatasetEntity dataset, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(dataset);
        dataset.RowKey = DatasetEntity.Row;
        return _datasets.UpsertAsync(DatasetEntity.Partition, dataset, cancellationToken);
    }
}
