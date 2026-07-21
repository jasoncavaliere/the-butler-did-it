namespace Butler.Api.Application.Assignments;

/// <summary>
/// The complete output of one fair-assignment run (Engineering Contract 7.6):
/// every chore in the request appears exactly once, either in
/// <see cref="Assignments"/> (placed with a person) or in
/// <see cref="Unassigned"/> (no eligible person). Both lists are emitted in the
/// engine's deterministic processing order, and every member is a record, so two
/// runs on identical input produce value-equal results - the "same assignment set"
/// the determinism criterion asserts.
/// </summary>
/// <param name="Assignments">The chores that were placed, in processing order.</param>
/// <param name="Unassigned">The chores that could not be placed, each with a reason code, in processing order.</param>
public sealed record FairAssignmentResult(
    IReadOnlyList<FairAssignment> Assignments,
    IReadOnlyList<UnassignedChore> Unassigned);

/// <summary>
/// One chore placed with one person by the engine (Engineering Contract 7.6).
/// </summary>
/// <param name="ChoreId">The assigned chore.</param>
/// <param name="PersonId">The eligible person who received it (lowest current load, tie-broken by fewest chores this week then lowest id).</param>
/// <param name="Effort">The chore's effort, added to that person's running load when it was assigned.</param>
public sealed record FairAssignment(string ChoreId, string PersonId, int Effort);

/// <summary>
/// A chore the engine could not place because no person was eligible for it
/// (Engineering Contract 7.6). Returned rather than thrown or skipped, so the
/// caller can surface it without the run failing.
/// </summary>
/// <param name="ChoreId">The chore that was not assigned.</param>
/// <param name="Effort">The chore's effort (carried through for the caller's reporting).</param>
/// <param name="Reason">A stable machine-readable reason code; see <see cref="UnassignedReasons"/>.</param>
public sealed record UnassignedChore(string ChoreId, int Effort, string Reason);

/// <summary>
/// The stable reason codes the engine attaches to an <see cref="UnassignedChore"/>.
/// Codes are constants (not free text) so callers and tests can branch on them.
/// </summary>
public static class UnassignedReasons
{
    /// <summary>No person in the request was eligible for the chore under the v1 eligibility rule.</summary>
    public const string NoEligiblePerson = "no-eligible-person";
}
