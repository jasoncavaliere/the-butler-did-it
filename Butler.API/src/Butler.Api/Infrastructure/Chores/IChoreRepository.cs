namespace Butler.Api.Infrastructure.Chores;

/// <summary>
/// Persistence seam for the Chores feature (Engineering Contract 7.3), built on
/// the shared F3 Table access layer. Every operation is scoped to a single
/// household by <c>PartitionKey = householdId</c>; there is no cross-household
/// query. Mutations flow through the shared optimistic-concurrency rules (a
/// missing <c>If-Match</c> is <c>428</c>, a stale one <c>412</c>).
/// </summary>
public interface IChoreRepository
{
    /// <summary>
    /// Adds a new <c>Chores</c> row to the household's partition. The entity's
    /// <c>RowKey</c> must already be the server-generated <c>choreId</c>.
    /// </summary>
    Task AddAsync(string householdId, ChoreEntity chore, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the chore with the given <c>choreId</c> in the household (carrying
    /// its current <c>ETag</c>), or <c>null</c> when no such chore exists.
    /// </summary>
    Task<ChoreEntity?> GetAsync(string householdId, string choreId, CancellationToken cancellationToken = default);

    /// <summary>Returns every chore in the household's partition.</summary>
    Task<IReadOnlyList<ChoreEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces a chore under optimistic concurrency. <paramref name="ifMatch"/>
    /// is required (<c>428</c> when missing) and must match the stored version
    /// (<c>412</c> when stale).
    /// </summary>
    Task UpdateAsync(string householdId, ChoreEntity chore, string? ifMatch, CancellationToken cancellationToken = default);
}
