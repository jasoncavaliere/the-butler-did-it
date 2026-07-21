namespace Butler.Api.Infrastructure.ChoreCompletions;

/// <summary>
/// Persistence seam for the <c>ChoreCompletions</c> table (Engineering Contract
/// 7.3), built on the shared F3 Table access layer. The ledger is
/// <b>append-only</b> (BRD R-2): there is no update or delete - an entry, once
/// written, is permanent. Every operation is scoped to a single household by
/// <c>PartitionKey = householdId</c>; there is no cross-household query.
/// </summary>
public interface IChoreCompletionRepository
{
    /// <summary>
    /// Appends a completion to the household's partition. The entity's
    /// <c>RowKey</c> must already be the <c>{completedUtcTicks}_{choreId}</c>
    /// composite.
    /// </summary>
    Task AddAsync(string householdId, ChoreCompletionEntity completion, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the completion with the given <paramref name="rowKey"/>
    /// (<c>{completedUtcTicks}_{choreId}</c>) in the household, or <c>null</c>
    /// when no such completion exists.
    /// </summary>
    Task<ChoreCompletionEntity?> GetAsync(string householdId, string rowKey, CancellationToken cancellationToken = default);

    /// <summary>Returns every completion in the household's partition.</summary>
    Task<IReadOnlyList<ChoreCompletionEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default);
}
