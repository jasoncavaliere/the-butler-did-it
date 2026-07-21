using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Infrastructure.Assignments;

/// <summary>
/// <see cref="IAssignmentRepository"/> on the shared F3 Table access seam
/// (<see cref="IEntityRepository{TEntity}"/>). It delegates to the generic
/// household-scoped repository, so every operation is keyed by
/// <c>PartitionKey = householdId</c> and an assignment is addressed by its
/// <c>{weekIso}_{choreId}</c> row key within that partition (Engineering
/// Contract 7.3).
/// </summary>
public sealed class TableAssignmentRepository : IAssignmentRepository
{
    private readonly IEntityRepository<AssignmentEntity> _assignments;

    public TableAssignmentRepository(IEntityRepository<AssignmentEntity> assignments)
    {
        ArgumentNullException.ThrowIfNull(assignments);
        _assignments = assignments;
    }

    /// <inheritdoc />
    public Task AddAsync(string householdId, AssignmentEntity assignment, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(assignment);
        ArgumentException.ThrowIfNullOrWhiteSpace(assignment.RowKey);
        return _assignments.AddAsync(householdId, assignment, cancellationToken);
    }

    /// <inheritdoc />
    public Task<AssignmentEntity?> GetAsync(string householdId, string rowKey, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(rowKey);
        return _assignments.GetAsync(householdId, rowKey, cancellationToken);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<AssignmentEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        return _assignments.ListAsync(householdId, cancellationToken);
    }

    /// <inheritdoc />
    public Task UpdateAsync(string householdId, AssignmentEntity assignment, string? ifMatch, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(assignment);
        ArgumentException.ThrowIfNullOrWhiteSpace(assignment.RowKey);
        return _assignments.UpdateAsync(householdId, assignment, ifMatch, cancellationToken);
    }
}
