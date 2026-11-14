using Azure.Data.Tables;
using Butler.Api.Application.Concurrency;

namespace Butler.Api.Infrastructure.Storage;

/// <summary>
/// Default <see cref="IHouseholdPartitionPurger"/> for one table. It lists the
/// household's partition and deletes every row under the wildcard
/// <c>If-Match</c>, so a concurrent write never blocks the wipe. A row that is
/// already gone (<see cref="PreconditionFailedException"/>) is skipped.
/// </summary>
/// <typeparam name="TEntity">The Table entity type stored in the table.</typeparam>
public sealed class HouseholdPartitionPurger<TEntity> : IHouseholdPartitionPurger
    where TEntity : class, ITableEntity, new()
{
    private readonly IEntityRepository<TEntity> _repository;

    public HouseholdPartitionPurger(IEntityRepository<TEntity> repository)
    {
        ArgumentNullException.ThrowIfNull(repository);
        _repository = repository;
    }

    /// <inheritdoc />
    public Type EntityType => typeof(TEntity);

    /// <inheritdoc />
    public async Task<int> PurgeAsync(string householdId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        var rows = await _repository.ListAsync(householdId, cancellationToken).ConfigureAwait(false);
        var deleted = 0;
        foreach (var row in rows)
        {
            try
            {
                await _repository
                    .DeleteAsync(householdId, row.RowKey, OptimisticConcurrency.Wildcard, cancellationToken)
                    .ConfigureAwait(false);
                deleted++;
            }
            catch (PreconditionFailedException)
            {
                // The row vanished between the list and the delete: the goal (no
                // row left) is already met, so it is not an error.
            }
        }

        return deleted;
    }
}
