namespace Butler.Api.Application.Assignments;

/// <summary>
/// The v1 fair-assignment engine (Engineering Contract 7.6): a pure, deterministic
/// function that, given a week's active chores and the eligible people (with their
/// trailing load), returns which person gets each chore. It is the highest-value
/// test surface in the chores epic and is intentionally free of side effects - no
/// storage, no clock, no randomness - so C3 owns all I/O and calls this with data
/// it already fetched.
/// </summary>
public interface IFairAssignmentEngine
{
    /// <summary>
    /// Produces the assignment set for one week from the supplied in-memory
    /// request, applying the 7.6 rules in order: eligibility (a child is eligible
    /// only for a chore whose <c>MinAge</c> is <c>null</c>); processing order
    /// (descending <c>Effort</c>, then ascending <c>ChoreId</c>); assignment to the
    /// eligible person with the lowest current load (trailing load plus effort
    /// already assigned this week), tie-broken by fewest chores assigned this week
    /// then lowest <c>PersonId</c>; and a chore with no eligible person returned as
    /// unassigned with a reason code rather than thrown or skipped. The same
    /// request always yields a value-equal result.
    /// </summary>
    /// <param name="request">The week's chores and eligible people. Must not be <c>null</c>, nor contain <c>null</c> chores or people.</param>
    /// <returns>The chores that were placed and the chores that could not be, both in processing order.</returns>
    FairAssignmentResult Assign(FairAssignmentRequest request);
}
