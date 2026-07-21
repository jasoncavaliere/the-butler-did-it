namespace Butler.Api.Application.Assignments;

/// <summary>
/// The complete, in-memory input to the v1 fair-assignment engine (Engineering
/// Contract 7.6): the week's active chores and the household's eligible people,
/// each person carrying their precomputed trailing-4-week completed load. The
/// engine is a pure function of this request - it reads nothing else (no storage,
/// no clock, no RNG), so C3 fetches the data, builds this request, and calls the
/// engine; the engine stays free of I/O.
/// </summary>
/// <param name="Chores">
/// The week's active chores to assign. Order is irrelevant - the engine imposes
/// its own deterministic processing order (descending <c>Effort</c>, then
/// ascending <c>ChoreId</c>).
/// </param>
/// <param name="People">
/// The people eligible to receive chores this week, each carrying
/// <see cref="FairAssignmentPerson.IsChild"/> and their trailing-4-week completed
/// load.
/// </param>
public sealed record FairAssignmentRequest(
    IReadOnlyCollection<FairAssignmentChore> Chores,
    IReadOnlyCollection<FairAssignmentPerson> People);

/// <summary>
/// A single active chore presented to the fair-assignment engine (Engineering
/// Contract 7.6). A pure input shape, deliberately decoupled from the
/// <c>Chores</c> Table entity so the engine takes no dependency on Infrastructure.
/// </summary>
/// <param name="ChoreId">The chore's stable identifier; the secondary, ascending sort key for stable processing order.</param>
/// <param name="Effort">The chore's relative effort weight; the engine balances load on this and processes higher-effort chores first.</param>
/// <param name="MinAge">
/// The minimum age required to be assigned this chore, or <c>null</c> when
/// unrestricted. Under the v1 rule a child (<see cref="FairAssignmentPerson.IsChild"/>)
/// is eligible only when this is <c>null</c>.
/// </param>
public sealed record FairAssignmentChore(string ChoreId, int Effort, int? MinAge);

/// <summary>
/// A single eligible person presented to the fair-assignment engine (Engineering
/// Contract 7.6). A pure input shape, deliberately decoupled from the
/// <c>People</c> Table entity.
/// </summary>
/// <param name="PersonId">The person's stable identifier; the final tie-break key (lowest wins).</param>
/// <param name="IsChild">Whether the person is a child; a child is eligible only for chores with a <c>null</c> <see cref="FairAssignmentChore.MinAge"/>.</param>
/// <param name="TrailingLoad">
/// The person's precomputed running load at the start of assignment: the sum of
/// <c>Effort</c> of their completions over the trailing 4 weeks. The engine adds
/// each chore's effort to this as it assigns, so later chores balance against
/// earlier ones.
/// </param>
public sealed record FairAssignmentPerson(string PersonId, bool IsChild, int TrailingLoad);
