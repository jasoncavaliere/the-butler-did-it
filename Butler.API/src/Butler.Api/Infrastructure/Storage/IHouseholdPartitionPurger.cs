namespace Butler.Api.Infrastructure.Storage;

/// <summary>
/// Deletes every row a household owns in one registered table (#124).
/// <see cref="StorageServiceCollectionExtensions.AddTableRepository{TEntity}"/>
/// registers one per entity type, so household teardown enumerates them all and
/// a newly registered table is purged with no change to the teardown code.
/// </summary>
public interface IHouseholdPartitionPurger
{
    /// <summary>The Table entity type whose repository this purger empties.</summary>
    Type EntityType { get; }

    /// <summary>
    /// Deletes every row in the household's partition of this table. A row that
    /// vanishes between the list and the delete is skipped, not an error.
    /// </summary>
    /// <param name="householdId">The household whose partition is emptied.</param>
    /// <param name="cancellationToken">Cancels the purge.</param>
    /// <returns>The number of rows this call deleted.</returns>
    Task<int> PurgeAsync(string householdId, CancellationToken cancellationToken = default);
}
