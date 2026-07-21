using Butler.Api.Application.Assignments;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// The primary test surface for the chores epic: the v1 fair-assignment engine
/// (Engineering Contract 7.6). Each of the binding rules - eligibility, load
/// definition, processing order, assignment target, tie-breaks, and the
/// no-eligible-person outcome - has a dedicated test, plus determinism and the
/// input guards. The engine is pure, so every case is a fixed-input assertion with
/// no clock, storage, or RNG in play (see <see cref="FairAssignmentEnginePurityTests"/>).
/// </summary>
public sealed class FairAssignmentEngineTests
{
    private static FairAssignmentEngine NewEngine() => new();

    private static FairAssignmentChore Chore(string id, int effort, int? minAge = null) => new(id, effort, minAge);

    private static FairAssignmentPerson Person(string id, bool isChild = false, int trailingLoad = 0) =>
        new(id, isChild, trailingLoad);

    // ---- Eligibility (Rule 1) ------------------------------------------------

    [Fact]
    public void A_child_is_excluded_from_a_chore_with_a_minimum_age()
    {
        var engine = NewEngine();
        var request = new FairAssignmentRequest(
            new[] { Chore("dishes", effort: 3, minAge: 12) },
            new[] { Person("maya", isChild: true) });

        var result = engine.Assign(request);

        Assert.Empty(result.Assignments);
        var unassigned = Assert.Single(result.Unassigned);
        Assert.Equal("dishes", unassigned.ChoreId);
        Assert.Equal(UnassignedReasons.NoEligiblePerson, unassigned.Reason);
    }

    [Fact]
    public void A_child_is_eligible_for_a_chore_with_no_minimum_age()
    {
        var engine = NewEngine();
        var request = new FairAssignmentRequest(
            new[] { Chore("tidy-toys", effort: 3, minAge: null) },
            new[] { Person("maya", isChild: true) });

        var result = engine.Assign(request);

        Assert.Empty(result.Unassigned);
        var assignment = Assert.Single(result.Assignments);
        Assert.Equal("tidy-toys", assignment.ChoreId);
        Assert.Equal("maya", assignment.PersonId);
    }

    [Fact]
    public void A_non_child_is_eligible_for_an_age_restricted_chore()
    {
        var engine = NewEngine();
        // A child and an adult; the age-gated chore must go to the adult.
        var request = new FairAssignmentRequest(
            new[] { Chore("power-tools", effort: 5, minAge: 16) },
            new[] { Person("maya", isChild: true), Person("sam", isChild: false) });

        var result = engine.Assign(request);

        Assert.Empty(result.Unassigned);
        var assignment = Assert.Single(result.Assignments);
        Assert.Equal("sam", assignment.PersonId);
    }

    // ---- Load balancing (Rules 2 & 3) ---------------------------------------

    [Fact]
    public void Higher_trailing_load_receives_less_new_effort()
    {
        var engine = NewEngine();
        // Pat starts two units of trailing load ahead of Sam. With two equal
        // chores the first goes to the lighter person, and the running load makes
        // the second land on the other - the distribution evens out rather than
        // dogpiling one person.
        var request = new FairAssignmentRequest(
            new[] { Chore("cA", effort: 3), Chore("cB", effort: 3) },
            new[] { Person("pat", trailingLoad: 2), Person("sam", trailingLoad: 0) });

        var result = engine.Assign(request);

        Assert.Empty(result.Unassigned);
        Assert.Equal(2, result.Assignments.Count);
        // Processing order is choreId-ascending for equal effort: cA then cB.
        Assert.Equal(("cA", "sam"), (result.Assignments[0].ChoreId, result.Assignments[0].PersonId));
        Assert.Equal(("cB", "pat"), (result.Assignments[1].ChoreId, result.Assignments[1].PersonId));
    }

    [Fact]
    public void All_of_several_equal_chores_pile_onto_the_much_lighter_person()
    {
        var engine = NewEngine();
        // Pat is so far ahead that both chores still land on Sam - "less new
        // effort for the heavier person" taken to its limit.
        var request = new FairAssignmentRequest(
            new[] { Chore("cA", effort: 3), Chore("cB", effort: 3) },
            new[] { Person("pat", trailingLoad: 10), Person("sam", trailingLoad: 0) });

        var result = engine.Assign(request);

        Assert.All(result.Assignments, a => Assert.Equal("sam", a.PersonId));
        Assert.DoesNotContain(result.Assignments, a => a.PersonId == "pat");
    }

    // ---- Processing order (Rule 2) ------------------------------------------

    [Fact]
    public void Chores_are_processed_by_descending_effort_then_ascending_chore_id()
    {
        var engine = NewEngine();
        // One person so every chore lands there; only the ORDER is under test.
        // Input order is deliberately scrambled.
        var request = new FairAssignmentRequest(
            new[] { Chore("c-b", effort: 5), Chore("c-c", effort: 8), Chore("c-a", effort: 5) },
            new[] { Person("solo") });

        var result = engine.Assign(request);

        var order = string.Join(",", result.Assignments.Select(a => a.ChoreId));
        // c-c first (highest effort), then the two effort-5 chores by ascending id.
        Assert.Equal("c-c,c-a,c-b", order);
    }

    // ---- Tie-breaks (Rule 4) ------------------------------------------------

    [Fact]
    public void Equal_load_is_broken_by_fewest_chores_assigned_this_week()
    {
        var engine = NewEngine();
        // Processing order is descending effort then ascending choreId:
        //   a-big, b-small, c-small, d-decide.
        //   a-big (6):  full tie -> p1.            p1: load6, chores1
        //   b-small(3): p2 lower load (0 < 6).     p2: load3, chores1
        //   c-small(3): p2 lower load (3 < 6).     p2: load6, chores2
        //   d-decide(3): p1 & p2 both load6; p1 carries fewer chores (1 < 2),
        //               so the fewest-chores tie-break sends d-decide to p1.
        var request = new FairAssignmentRequest(
            new[] { Chore("a-big", 6), Chore("b-small", 3), Chore("c-small", 3), Chore("d-decide", 3) },
            new[] { Person("p1"), Person("p2") });

        var result = engine.Assign(request);

        var decisive = Assert.Single(result.Assignments, a => a.ChoreId == "d-decide");
        Assert.Equal("p1", decisive.PersonId);
    }

    [Fact]
    public void Fewest_chores_can_override_the_person_evaluated_first()
    {
        var engine = NewEngine();
        // The mirror of the previous case: here the person listed first (p1) is the
        // one carrying MORE chores at equal load, so the later candidate (p2) must
        // win on fewest-chores - proving the tie-break, not list order, decides.
        // Processing order: p(2), q(2), r(1).
        //   p (2): p1 lower load (0 < 4).      p1: load2, chores1
        //   q (2): p1 lower load (2 < 4).      p1: load4, chores2
        //   r (1): p1 & p2 both load4; p2 carries fewer chores (0 < 2) -> r to p2.
        var request = new FairAssignmentRequest(
            new[] { Chore("p", 2), Chore("q", 2), Chore("r", 1) },
            new[] { Person("p1", trailingLoad: 0), Person("p2", trailingLoad: 4) });

        var result = engine.Assign(request);

        var decisive = Assert.Single(result.Assignments, a => a.ChoreId == "r");
        Assert.Equal("p2", decisive.PersonId);
    }

    [Fact]
    public void A_full_tie_is_broken_by_lowest_person_id()
    {
        var engine = NewEngine();
        // Identical load and zero chores each: only the id breaks the tie, and the
        // lower ordinal id wins regardless of input order.
        var request = new FairAssignmentRequest(
            new[] { Chore("solo-chore", effort: 3) },
            new[] { Person("zoe"), Person("amy") });

        var result = engine.Assign(request);

        var assignment = Assert.Single(result.Assignments);
        Assert.Equal("amy", assignment.PersonId);
    }

    // ---- No eligible person (Rule 5) ----------------------------------------

    [Fact]
    public void A_chore_with_no_eligible_person_is_returned_unassigned_without_throwing()
    {
        var engine = NewEngine();
        // Only a child, and the chore is age-gated: no eligible person.
        var request = new FairAssignmentRequest(
            new[] { Chore("mow-lawn", effort: 5, minAge: 16) },
            new[] { Person("maya", isChild: true) });

        var result = engine.Assign(request);

        Assert.Empty(result.Assignments);
        var unassigned = Assert.Single(result.Unassigned);
        Assert.Equal("mow-lawn", unassigned.ChoreId);
        Assert.Equal(5, unassigned.Effort);
        Assert.Equal(UnassignedReasons.NoEligiblePerson, unassigned.Reason);
    }

    [Fact]
    public void A_chore_with_no_people_at_all_is_returned_unassigned()
    {
        var engine = NewEngine();
        var request = new FairAssignmentRequest(
            new[] { Chore("dishes", effort: 3) },
            Array.Empty<FairAssignmentPerson>());

        var result = engine.Assign(request);

        var unassigned = Assert.Single(result.Unassigned);
        Assert.Equal(UnassignedReasons.NoEligiblePerson, unassigned.Reason);
    }

    [Fact]
    public void An_empty_request_yields_an_empty_result()
    {
        var engine = NewEngine();
        var request = new FairAssignmentRequest(
            Array.Empty<FairAssignmentChore>(),
            Array.Empty<FairAssignmentPerson>());

        var result = engine.Assign(request);

        Assert.Empty(result.Assignments);
        Assert.Empty(result.Unassigned);
    }

    // ---- Determinism (Rule 4 / NFR) -----------------------------------------

    [Fact]
    public void The_same_input_run_twice_yields_an_identical_assignment_set()
    {
        var engine = NewEngine();
        var request = BuildMixedRequest();

        var first = engine.Assign(request);
        var second = engine.Assign(request);

        // Identical assignment set: same person per chore, same order, in both the
        // assigned and unassigned lists. FairAssignment/UnassignedChore are records,
        // so SequenceEqual compares them by value.
        Assert.True(first.Assignments.SequenceEqual(second.Assignments));
        Assert.True(first.Unassigned.SequenceEqual(second.Unassigned));
        // A non-trivial fixture: every chore is placed across the three people, so
        // the equality above is over a real, non-empty assignment set.
        Assert.Equal(5, first.Assignments.Count);
    }

    [Fact]
    public void A_fresh_engine_instance_produces_the_identical_set_for_the_same_input()
    {
        // The engine holds no state between runs, so a second instance must agree
        // with the first - reinforcing determinism across instances.
        var request = BuildMixedRequest();

        var first = NewEngine().Assign(request);
        var second = NewEngine().Assign(request);

        Assert.True(first.Assignments.SequenceEqual(second.Assignments));
        Assert.True(first.Unassigned.SequenceEqual(second.Unassigned));
    }

    // A representative mix: varied efforts, a child, an age-gated chore, and
    // uneven trailing load - enough to exercise ordering, eligibility, balancing,
    // and an unassignable chore in one determinism fixture.
    private static FairAssignmentRequest BuildMixedRequest() => new(
        new[]
        {
            Chore("kitchen", effort: 8),
            Chore("trash", effort: 3),
            Chore("vacuum", effort: 3),
            Chore("garage", effort: 6, minAge: 16),
            Chore("attic", effort: 6, minAge: 16),
        },
        new[]
        {
            Person("pat", isChild: false, trailingLoad: 4),
            Person("sam", isChild: false, trailingLoad: 1),
            Person("maya", isChild: true, trailingLoad: 0),
        });

    // ---- Input guards (purity NFR: fail fast, no partial/undefined runs) -----

    [Fact]
    public void Assign_rejects_a_null_request()
    {
        var engine = NewEngine();
        Assert.Throws<ArgumentNullException>(() => engine.Assign(null!));
    }

    [Fact]
    public void Assign_rejects_null_chores()
    {
        var engine = NewEngine();
        var request = new FairAssignmentRequest(null!, Array.Empty<FairAssignmentPerson>());
        Assert.Throws<ArgumentNullException>(() => engine.Assign(request));
    }

    [Fact]
    public void Assign_rejects_null_people()
    {
        var engine = NewEngine();
        var request = new FairAssignmentRequest(Array.Empty<FairAssignmentChore>(), null!);
        Assert.Throws<ArgumentNullException>(() => engine.Assign(request));
    }

    [Fact]
    public void Assign_rejects_a_null_person_element()
    {
        var engine = NewEngine();
        var request = new FairAssignmentRequest(
            Array.Empty<FairAssignmentChore>(),
            new FairAssignmentPerson[] { null! });
        Assert.Throws<ArgumentNullException>(() => engine.Assign(request));
    }

    [Fact]
    public void Assign_rejects_a_null_chore_element()
    {
        var engine = NewEngine();
        var request = new FairAssignmentRequest(
            new FairAssignmentChore[] { null! },
            new[] { Person("solo") });
        Assert.Throws<ArgumentNullException>(() => engine.Assign(request));
    }
}
