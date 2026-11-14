namespace Butler.Api.Infrastructure.System;

/// <summary>
/// Persistence seam for the deployment's single dataset row (#100 D7). Every
/// operation addresses the fixed <see cref="DatasetEntity.Partition"/> /
/// <see cref="DatasetEntity.Row"/> key, the documented exception to
/// Engineering Contract 7.3.
/// </summary>
public interface IDatasetRepository
{
    /// <summary>Returns the stored dataset row, or <c>null</c> when none exists.</summary>
    Task<DatasetEntity?> GetAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Adds the dataset row. Throws when a row already exists, so a lost
    /// first-write race never silently replaces an id a client has seen.
    /// </summary>
    Task AddAsync(DatasetEntity dataset, CancellationToken cancellationToken = default);

    /// <summary>Inserts or replaces the dataset row (no concurrency check).</summary>
    Task UpsertAsync(DatasetEntity dataset, CancellationToken cancellationToken = default);
}
