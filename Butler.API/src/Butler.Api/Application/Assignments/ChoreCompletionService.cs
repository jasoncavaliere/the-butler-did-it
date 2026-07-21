using Butler.Api.Infrastructure.Assignments;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Chores;

namespace Butler.Api.Application.Assignments;

/// <summary>
/// Default <see cref="IChoreCompletionService"/> - the C4 composition behind the
/// tap-to-complete endpoint. It reads the assignment, appends an append-only
/// <c>ChoreCompletion</c>, and flips the assignment to <c>Done</c> under optimistic
/// concurrency (Engineering Contract 7.3, BRD R-2). All I/O lives here; time comes
/// from the injected <see cref="TimeProvider"/> seam so the recorded instant stays
/// deterministic (7.5).
/// </summary>
public sealed class ChoreCompletionService : IChoreCompletionService
{
    private readonly IAssignmentRepository _assignments;
    private readonly IChoreCompletionRepository _completions;
    private readonly IChoreRepository _chores;
    private readonly TimeProvider _clock;

    public ChoreCompletionService(
        IAssignmentRepository assignments,
        IChoreCompletionRepository completions,
        IChoreRepository chores,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(assignments);
        ArgumentNullException.ThrowIfNull(completions);
        ArgumentNullException.ThrowIfNull(chores);
        ArgumentNullException.ThrowIfNull(clock);
        _assignments = assignments;
        _completions = completions;
        _chores = chores;
        _clock = clock;
    }

    /// <inheritdoc />
    public async Task<CompleteChoreResponse?> CompleteAsync(
        string householdId,
        string weekIso,
        string choreId,
        string personId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(weekIso);
        ArgumentException.ThrowIfNullOrWhiteSpace(choreId);
        ArgumentException.ThrowIfNullOrWhiteSpace(personId);

        var rowKey = RowKeyFor(weekIso, choreId);

        // Unknown assignment is a 404, surfaced to the caller as a null result.
        var assignment = await _assignments.GetAsync(householdId, rowKey, cancellationToken).ConfigureAwait(false);
        if (assignment is null)
        {
            return null;
        }

        // Idempotent double-complete: an assignment already Done is a success no-op.
        // We append nothing (so a second tap never double-counts the effort in the
        // trailing-load fairness math) and never touch the append-only ledger.
        if (string.Equals(assignment.Status, AssignmentStatus.Done, StringComparison.Ordinal))
        {
            return Respond(assignment);
        }

        // The effort credited mirrors the chore's effort (H3). The assignment
        // existing implies the chore does; treat a missing chore defensively as no
        // effort rather than failing the completion.
        var chore = await _chores.GetAsync(householdId, choreId, cancellationToken).ConfigureAwait(false);
        var effort = chore?.Effort ?? 0;

        var completedUtc = _clock.GetUtcNow();
        var completion = new ChoreCompletionEntity
        {
            PartitionKey = householdId,
            RowKey = $"{completedUtc.UtcTicks}_{choreId}",
            ChoreId = choreId,
            PersonId = personId,
            CompletedUtc = completedUtc,
            Effort = effort,
            WeekIso = assignment.WeekIso,
        };
        await _completions.AddAsync(householdId, completion, cancellationToken).ConfigureAwait(false);

        // Flip the status to Done under optimistic concurrency, using the ETag from
        // the read as the If-Match precondition (last-writer-wins per the composite
        // key). The completion is already durable; the status is the recoverable
        // projection an offline resync can re-flip safely (Epic 60).
        var ifMatch = assignment.ETag.ToString();
        assignment.Status = AssignmentStatus.Done;
        await _assignments.UpdateAsync(householdId, assignment, ifMatch, cancellationToken).ConfigureAwait(false);

        return Respond(assignment);
    }

    private static CompleteChoreResponse Respond(AssignmentEntity assignment) => new(
        assignment.WeekIso,
        ChoreIdOf(assignment),
        assignment.AssignedPersonId,
        AssignmentStatus.Done);

    // Assignment row keys are the {weekIso}_{choreId} composite (Contract 7.3).
    private static string RowKeyFor(string weekIso, string choreId) => $"{weekIso}_{choreId}";

    // Recover the choreId from an assignment's {weekIso}_{choreId} row key: the week
    // prefix has a fixed shape, so the chore id is everything after the first
    // underscore.
    private static string ChoreIdOf(AssignmentEntity assignment)
    {
        var separator = assignment.RowKey.IndexOf('_', StringComparison.Ordinal);
        return separator < 0 ? assignment.RowKey : assignment.RowKey[(separator + 1)..];
    }
}
