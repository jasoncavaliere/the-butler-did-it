using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Infrastructure.ChoreCompletions;

/// <summary>
/// <see cref="IChoreCompletionRepository"/> on the shared F3 Table access seam
/// (<see cref="IEntityRepository{TEntity}"/>). It delegates to the generic
/// household-scoped repository, so every operation is keyed by
/// <c>PartitionKey = householdId</c> and a completion is addressed by its
/// <c>{completedUtcTicks}_{choreId}</c> row key. Only append and read are exposed;
/// the ledger is never mutated (BRD R-2).
/// </summary>
public sealed class TableChoreCompletionRepository : IChoreCompletionRepository
{
    private readonly IEntityRepository<ChoreCompletionEntity> _completions;

    public TableChoreCompletionRepository(IEntityRepository<ChoreCompletionEntity> completions)
    {
        ArgumentNullException.ThrowIfNull(completions);
        _completions = completions;
    }

    /// <inheritdoc />
    public Task AddAsync(string householdId, ChoreCompletionEntity completion, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(completion);
        ArgumentException.ThrowIfNullOrWhiteSpace(completion.RowKey);
        return _completions.AddAsync(householdId, completion, cancellationToken);
    }

    /// <inheritdoc />
    public Task<ChoreCompletionEntity?> GetAsync(string householdId, string rowKey, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(rowKey);
        return _completions.GetAsync(householdId, rowKey, cancellationToken);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<ChoreCompletionEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        return _completions.ListAsync(householdId, cancellationToken);
    }
}
