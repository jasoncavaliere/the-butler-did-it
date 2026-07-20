using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Infrastructure.Chores;

/// <summary>
/// <see cref="IChoreRepository"/> on the shared F3 Table access seam
/// (<see cref="IEntityRepository{TEntity}"/>). It delegates to the generic
/// household-scoped repository, so every operation is keyed by
/// <c>PartitionKey = householdId</c> and a chore is addressed by its
/// <c>choreId</c> within that partition (Engineering Contract 7.3).
/// </summary>
public sealed class TableChoreRepository : IChoreRepository
{
    private readonly IEntityRepository<ChoreEntity> _chores;

    public TableChoreRepository(IEntityRepository<ChoreEntity> chores)
    {
        ArgumentNullException.ThrowIfNull(chores);
        _chores = chores;
    }

    /// <inheritdoc />
    public Task AddAsync(string householdId, ChoreEntity chore, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(chore);
        ArgumentException.ThrowIfNullOrWhiteSpace(chore.RowKey);
        return _chores.AddAsync(householdId, chore, cancellationToken);
    }

    /// <inheritdoc />
    public Task<ChoreEntity?> GetAsync(string householdId, string choreId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(choreId);
        return _chores.GetAsync(householdId, choreId, cancellationToken);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<ChoreEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        return _chores.ListAsync(householdId, cancellationToken);
    }

    /// <inheritdoc />
    public Task UpdateAsync(string householdId, ChoreEntity chore, string? ifMatch, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(chore);
        ArgumentException.ThrowIfNullOrWhiteSpace(chore.RowKey);
        return _chores.UpdateAsync(householdId, chore, ifMatch, cancellationToken);
    }
}
