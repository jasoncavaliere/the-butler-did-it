namespace Butler.Api.Application.Assignments;

/// <summary>
/// The result of generating (or regenerating) one household week's chore
/// assignments (C3). It carries the week it applies to, every chore that ended up
/// placed with a person - the freshly-assigned <c>Open</c> ones plus any
/// <c>Done</c> ones a regenerate preserved - and every chore the C2 engine could
/// not place, each with its stable reason code (Engineering Contract 7.6). Both
/// lists are ordered by <c>ChoreId</c> so the response is deterministic.
/// </summary>
/// <param name="WeekIso">The ISO-8601 year-week the assignments belong to (for example <c>2026-W29</c>).</param>
/// <param name="Assignments">Every placed chore for the week, ordered by <c>ChoreId</c>.</param>
/// <param name="Unassigned">Every chore the engine left unassigned, with its reason, ordered by <c>ChoreId</c>.</param>
public sealed record AssignmentSetResponse(
    string WeekIso,
    IReadOnlyList<AssignmentView> Assignments,
    IReadOnlyList<UnassignedView> Unassigned);

/// <summary>
/// One placed chore in an <see cref="AssignmentSetResponse"/>: who it went to,
/// its effort, and whether it is still <c>Open</c> or was already completed
/// (<c>Done</c>) and preserved by a regenerate.
/// </summary>
/// <param name="ChoreId">The assigned chore.</param>
/// <param name="AssignedPersonId">The person the chore is assigned to for the week.</param>
/// <param name="Effort">The chore's effort weight.</param>
/// <param name="Status">The assignment's lifecycle state: <c>Open</c> or <c>Done</c>.</param>
public sealed record AssignmentView(
    string ChoreId,
    string AssignedPersonId,
    int Effort,
    string Status);

/// <summary>
/// One chore the C2 engine could not place in an
/// <see cref="AssignmentSetResponse"/>, surfaced rather than dropped so the caller
/// can show it (Engineering Contract 7.6).
/// </summary>
/// <param name="ChoreId">The chore that was not assigned.</param>
/// <param name="Effort">The chore's effort weight.</param>
/// <param name="Reason">The stable machine-readable reason code (see <see cref="UnassignedReasons"/>).</param>
public sealed record UnassignedView(
    string ChoreId,
    int Effort,
    string Reason);
