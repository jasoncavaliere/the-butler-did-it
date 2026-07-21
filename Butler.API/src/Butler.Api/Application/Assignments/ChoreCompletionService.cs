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

    /// <inheritdoc />
    public async Task<UndoChoreResponse?> UndoAsync(
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

        // Idempotent undo: an assignment that is not Done (already Open, or never
        // completed) is a success no-op. We append no compensating entry (so a second
        // undo never double-subtracts the effort in the trailing-load fairness math)
        // and never re-write the assignment.
        if (!string.Equals(assignment.Status, AssignmentStatus.Done, StringComparison.Ordinal))
        {
            return RespondOpen(assignment);
        }

        // The effort backed out mirrors the effort credited on completion: the chore's
        // effort (H3). The assignment existing implies the chore does; treat a missing
        // chore defensively as no effort rather than failing the undo.
        var chore = await _chores.GetAsync(householdId, choreId, cancellationToken).ConfigureAwait(false);
        var effort = chore?.Effort ?? 0;

        // Append-only reversal (BRD R-2): the original completion is never deleted or
        // mutated. Instead a compensating entry of -effort is appended in the same
        // week for the acting person, so their net trailing load returns to its
        // pre-completion value. The "_void" row-key suffix keeps the entry auditable
        // and guarantees it can never collide with the original append's row key.
        var reversedUtc = _clock.GetUtcNow();
        var reversal = new ChoreCompletionEntity
        {
            PartitionKey = householdId,
            RowKey = $"{reversedUtc.UtcTicks}_{choreId}_void",
            ChoreId = choreId,
            PersonId = personId,
            CompletedUtc = reversedUtc,
            Effort = -effort,
            WeekIso = assignment.WeekIso,
        };
        await _completions.AddAsync(householdId, reversal, cancellationToken).ConfigureAwait(false);

        // Flip the status back to Open under optimistic concurrency, using the ETag
        // from the read as the If-Match precondition (last-writer-wins per the
        // composite key), mirroring the complete path in reverse.
        var ifMatch = assignment.ETag.ToString();
        assignment.Status = AssignmentStatus.Open;
        await _assignments.UpdateAsync(householdId, assignment, ifMatch, cancellationToken).ConfigureAwait(false);

        return RespondOpen(assignment);
    }

    private static CompleteChoreResponse Respond(AssignmentEntity assignment) => new(
        assignment.WeekIso,
        ChoreIdOf(assignment),
        assignment.AssignedPersonId,
        AssignmentStatus.Done);

    // The undo response reports the assignment's status as it stands (Open after a
    // reversal, or already Open on the idempotent no-op).
    private static UndoChoreResponse RespondOpen(AssignmentEntity assignment) => new(
        assignment.WeekIso,
        ChoreIdOf(assignment),
        assignment.AssignedPersonId,
        assignment.Status);

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
