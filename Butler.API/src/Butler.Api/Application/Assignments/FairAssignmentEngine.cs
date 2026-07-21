namespace Butler.Api.Application.Assignments;

/// <summary>
/// Default <see cref="IFairAssignmentEngine"/> - the v1 fair-assignment algorithm
/// (Engineering Contract 7.6) implemented as a pure, deterministic function.
///
/// <para>
/// It operates only on the in-memory <see cref="FairAssignmentRequest"/>: it reads
/// no storage, no clock, and no RNG, so the same inputs always produce a
/// value-equal <see cref="FairAssignmentResult"/>. The type is stateless (all
/// working state is local to a single <see cref="Assign"/> call), so it is safe to
/// register as a singleton.
/// </para>
///
/// <para>The rules, applied in order:</para>
/// <list type="number">
///   <item><b>Eligibility.</b> A non-child is eligible for every chore; a child is eligible only for a chore whose <c>MinAge</c> is <c>null</c>.</item>
///   <item><b>Processing order.</b> Chores are processed by descending <c>Effort</c>, then ascending <c>ChoreId</c> (ordinal) for stability.</item>
///   <item><b>Assignment.</b> Each chore goes to the eligible person with the lowest current load (trailing load plus effort already assigned this week); that person's running load then grows by the chore's effort.</item>
///   <item><b>Tie-break.</b> Equal current load is resolved by fewest chores assigned this week, then by lowest <c>PersonId</c> (ordinal).</item>
///   <item><b>No eligible person.</b> The chore is returned unassigned with a reason code - never thrown, never skipped.</item>
/// </list>
/// </summary>
public sealed class FairAssignmentEngine : IFairAssignmentEngine
{
    /// <inheritdoc />
    public FairAssignmentResult Assign(FairAssignmentRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.Chores);
        ArgumentNullException.ThrowIfNull(request.People);

        // Mutable working copy of each person's running load and chore count for
        // this run only; the record inputs are never mutated.
        var people = new List<PersonState>(request.People.Count);
        foreach (var person in request.People)
        {
            ArgumentNullException.ThrowIfNull(person);
            people.Add(new PersonState(person));
        }

        // Rule 2: descending Effort, then ascending ChoreId for a stable,
        // deterministic processing order.
        var ordered = new List<FairAssignmentChore>(request.Chores.Count);
        foreach (var chore in request.Chores)
        {
            ArgumentNullException.ThrowIfNull(chore);
            ordered.Add(chore);
        }

        ordered.Sort(static (left, right) =>
        {
            var byEffort = right.Effort.CompareTo(left.Effort);
            return byEffort != 0
                ? byEffort
                : string.CompareOrdinal(left.ChoreId, right.ChoreId);
        });

        var assignments = new List<FairAssignment>();
        var unassigned = new List<UnassignedChore>();

        foreach (var chore in ordered)
        {
            var winner = SelectAssignee(people, chore);
            if (winner is null)
            {
                // Rule 5: no eligible person - report, do not throw or skip.
                unassigned.Add(new UnassignedChore(chore.ChoreId, chore.Effort, UnassignedReasons.NoEligiblePerson));
                continue;
            }

            assignments.Add(new FairAssignment(chore.ChoreId, winner.PersonId, chore.Effort));

            // Rule 3: the assignee's running load grows by this chore's effort so
            // subsequent chores balance against it.
            winner.Load += chore.Effort;
            winner.ChoresThisWeek++;
        }

        return new FairAssignmentResult(assignments, unassigned);
    }

    // Rules 1, 3, 4: among the people eligible for this chore, pick the lowest
    // current load, breaking ties by fewest chores assigned this week, then by
    // lowest PersonId (ordinal). Returns null when nobody is eligible.
    private static PersonState? SelectAssignee(List<PersonState> people, FairAssignmentChore chore)
    {
        PersonState? best = null;
        foreach (var candidate in people)
        {
            if (!IsEligible(candidate, chore))
            {
                continue;
            }

            if (best is null || IsBetterAssignee(candidate, best))
            {
                best = candidate;
            }
        }

        return best;
    }

    // Rule 1 (v1): a non-child is eligible for every chore; a child is eligible
    // only when the chore has no minimum age.
    private static bool IsEligible(PersonState person, FairAssignmentChore chore) =>
        !person.IsChild || chore.MinAge is null;

    // Rule 4: lower load wins; tie -> fewer chores this week; tie -> lower PersonId.
    private static bool IsBetterAssignee(PersonState candidate, PersonState current)
    {
        if (candidate.Load != current.Load)
        {
            return candidate.Load < current.Load;
        }

        if (candidate.ChoresThisWeek != current.ChoresThisWeek)
        {
            return candidate.ChoresThisWeek < current.ChoresThisWeek;
        }

        return string.CompareOrdinal(candidate.PersonId, current.PersonId) < 0;
    }

    // Per-run mutable state: seeded from the immutable person input.
    private sealed class PersonState
    {
        public PersonState(FairAssignmentPerson person)
        {
            PersonId = person.PersonId;
            IsChild = person.IsChild;
            Load = person.TrailingLoad;
        }

        public string PersonId { get; }

        public bool IsChild { get; }

        public int Load { get; set; }

        public int ChoresThisWeek { get; set; }
    }
}
