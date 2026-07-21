namespace Butler.Api.Infrastructure.Assignments;

/// <summary>
/// Persistence seam for the <c>Assignments</c> table (Engineering Contract 7.3),
/// built on the shared F3 Table access layer. Every operation is scoped to a
/// single household by <c>PartitionKey = householdId</c>; there is no
/// cross-household query. The status mutation flows through the shared
/// optimistic-concurrency rules (a missing <c>If-Match</c> is <c>428</c>, a stale
/// one <c>412</c>) - that behavior is exercised by C4, on this seam.
/// </summary>
public interface IAssignmentRepository
{
    /// <summary>
    /// Adds a new <c>Assignments</c> row to the household's partition. The
    /// entity's <c>RowKey</c> must already be the <c>{weekIso}_{choreId}</c>
    /// composite.
    /// </summary>
    Task AddAsync(string householdId, AssignmentEntity assignment, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the assignment with the given <paramref name="rowKey"/>
    /// (<c>{weekIso}_{choreId}</c>) in the household, carrying its current
    /// <c>ETag</c>, or <c>null</c> when no such assignment exists.
    /// </summary>
    Task<AssignmentEntity?> GetAsync(string householdId, string rowKey, CancellationToken cancellationToken = default);

    /// <summary>Returns every assignment in the household's partition.</summary>
    Task<IReadOnlyList<AssignmentEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces an assignment under optimistic concurrency (for example to flip
    /// <see cref="AssignmentEntity.Status"/> to <see cref="AssignmentStatus.Done"/>).
    /// <paramref name="ifMatch"/> is required (<c>428</c> when missing) and must
    /// match the stored version (<c>412</c> when stale).
    /// </summary>
    Task UpdateAsync(string householdId, AssignmentEntity assignment, string? ifMatch, CancellationToken cancellationToken = default);
}
