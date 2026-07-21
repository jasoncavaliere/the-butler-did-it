namespace Butler.Api.Application.Assignments;

/// <summary>
/// The one place that composes the tap-to-complete write (C4, journey 6.2): it
/// appends an append-only <c>ChoreCompletion</c> and flips the matching
/// <c>Assignment.Status</c> to <see cref="Butler.Api.Infrastructure.Assignments.AssignmentStatus.Done"/>
/// under optimistic concurrency (BRD R-2). Completion is not a sensitive action
/// (Decision D-3), so a tap-to-claim participant (T1) or a paired hub device (T5)
/// may drive it - the actor's <c>personId</c> is supplied by the caller. Time
/// arrives through the injected <see cref="TimeProvider"/> seam so the recorded
/// completion instant stays deterministically testable (Engineering Contract 7.5).
/// </summary>
public interface IChoreCompletionService
{
    /// <summary>
    /// Completes one assignment from a tap.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Appends a <c>ChoreCompletion</c> crediting <paramref name="personId"/> with
    /// the chore's effort at the injected clock's instant, bucketed into the
    /// assignment's ISO week, and sets the assignment's status to <c>Done</c> using
    /// the row's read <c>ETag</c> as the <c>If-Match</c> precondition (last-writer-wins
    /// per <c>(householdId, weekIso, choreId)</c>).
    /// </para>
    /// <para>
    /// <b>Idempotent double-complete.</b> When the assignment is already <c>Done</c>
    /// the call is a success no-op: no second completion is appended (so trailing-load
    /// fairness never double-counts) and the append-only ledger is never mutated.
    /// </para>
    /// </remarks>
    /// <param name="householdId">The household the assignment belongs to.</param>
    /// <param name="weekIso">The assignment's ISO year-week (for example <c>2026-W29</c>).</param>
    /// <param name="choreId">The completed chore.</param>
    /// <param name="personId">The actor the completion is attributed to.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>
    /// The completed assignment's state, or <c>null</c> when no assignment matches
    /// <c>(householdId, weekIso, choreId)</c> (the controller maps that to a <c>404</c>).
    /// </returns>
    Task<CompleteChoreResponse?> CompleteAsync(
        string householdId,
        string weekIso,
        string choreId,
        string personId,
        CancellationToken cancellationToken = default);
}
