using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Assignments;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Concurrency;
using Butler.Api.Domain.Scheduling;
using Butler.Api.Infrastructure.Assignments;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Chores;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.People;
using Butler.Api.Tests.TestSupport;
using NSubstitute;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Criteria (C3): the generation service composes fetch -> compute -> persist. It
/// runs the real (pure) C2 engine over the household's <c>Active</c> chores and
/// people, computes each person's trailing-4-week load from the completions
/// ledger, resolves the week from the injected clock when none is supplied, and
/// persists through the C1 <see cref="IAssignmentRepository"/>. Regenerating a
/// week replaces its <c>Open</c> rows but preserves <c>Done</c> ones (and their
/// completions), reflecting completed effort in the recomputed loads so a done
/// chore is never re-assigned. Loads are read net of undo (#291), so a
/// cross-person or organizer undo credits the effort back to the completer. The
/// repositories are NSubstitute fakes and the clock is fixed, so every assertion
/// is deterministic.
/// </summary>
public sealed class AssignmentGenerationServiceTests
{
    private const string Household = "house-1";

    // A Wednesday in ISO week 2026-W29 (Monday 2026-07-13 .. Sunday 2026-07-19).
    private static readonly DateTimeOffset MidWeek29 = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);
    private const string Week29 = "2026-W29";

    private sealed class Harness
    {
        public IHouseholdRepository Households { get; } = Substitute.For<IHouseholdRepository>();

        public IChoreRepository Chores { get; } = Substitute.For<IChoreRepository>();

        public IPersonRepository People { get; } = Substitute.For<IPersonRepository>();

        public IChoreCompletionRepository Completions { get; } = Substitute.For<IChoreCompletionRepository>();

        public IAssignmentRepository Assignments { get; } = Substitute.For<IAssignmentRepository>();

        public MutableClock Clock { get; } = new(MidWeek29);

        public AssignmentGenerationGate Gate { get; } = new();

        public AssignmentGenerationService Service => new(
            Households,
            Chores,
            People,
            Completions,
            Assignments,
            new FairAssignmentEngine(),
            Clock,
            Gate);

        public Harness()
        {
            // Sensible empty defaults; individual tests override what they need.
            Households.GetAsync(Household, Arg.Any<CancellationToken>())
                .Returns(new HouseholdEntity { PartitionKey = Household, RowKey = Household, Name = "Home" });
            Chores.ListAsync(Household, Arg.Any<CancellationToken>())
                .Returns(Array.Empty<ChoreEntity>());
            People.ListAsync(Household, Arg.Any<CancellationToken>())
                .Returns(Array.Empty<PersonEntity>());
            Completions.ListAsync(Household, Arg.Any<CancellationToken>())
                .Returns(Array.Empty<ChoreCompletionEntity>());
            Assignments.ListAsync(Household, Arg.Any<CancellationToken>())
                .Returns(Array.Empty<AssignmentEntity>());
        }

        public void SetChores(params ChoreEntity[] chores) =>
            Chores.ListAsync(Household, Arg.Any<CancellationToken>()).Returns(chores);

        public void SetPeople(params PersonEntity[] people) =>
            People.ListAsync(Household, Arg.Any<CancellationToken>()).Returns(people);

        public void SetCompletions(params ChoreCompletionEntity[] completions) =>
            Completions.ListAsync(Household, Arg.Any<CancellationToken>()).Returns(completions);

        public void SetExistingAssignments(params AssignmentEntity[] assignments) =>
            Assignments.ListAsync(Household, Arg.Any<CancellationToken>()).Returns(assignments);
    }

    private static ChoreEntity Chore(string id, int effort, bool active = true, int? minAge = null) => new()
    {
        PartitionKey = Household,
        RowKey = id,
        Title = id,
        RoomId = "room-1",
        Cadence = "Weekly",
        Effort = effort,
        MinAge = minAge,
        Active = active,
    };

    private static PersonEntity Person(string id, bool isChild = false) => new()
    {
        PartitionKey = Household,
        RowKey = id,
        DisplayName = id,
        Role = "Participant",
        IsChild = isChild,
    };

    private static PersonEntity Organizer(string id) => new()
    {
        PartitionKey = Household,
        RowKey = id,
        DisplayName = id,
        Role = OrganizerAuthorization.OrganizerRole,
        IsChild = false,
    };

    private static ChoreCompletionEntity Completion(string choreId, string personId, int effort, string weekIso) => new()
    {
        PartitionKey = Household,
        RowKey = $"{weekIso}_{choreId}_{personId}",
        ChoreId = choreId,
        PersonId = personId,
        Effort = effort,
        WeekIso = weekIso,
    };

    // A compensating undo row as the C7 write path appends it: a _void row key,
    // negative effort, stamped with whoever pressed undo. Its CompletedUtc is later
    // than the default instant Completion leaves, so it replays after them.
    private static ChoreCompletionEntity Reversal(string choreId, string undoerId, int effort, string weekIso) => new()
    {
        PartitionKey = Household,
        RowKey = $"{weekIso}_{choreId}_{undoerId}{ChoreCompletionLedger.ReversalSuffix}",
        ChoreId = choreId,
        PersonId = undoerId,
        Effort = -effort,
        WeekIso = weekIso,
        CompletedUtc = MidWeek29,
    };

    // Runs one generation over the harness with a substitute engine and returns the
    // exact trailing load each person was handed to the C2 engine.
    private static async Task<IReadOnlyDictionary<string, int>> CapturedTrailingLoadsAsync(Harness harness)
    {
        FairAssignmentRequest? captured = null;
        var engine = Substitute.For<IFairAssignmentEngine>();
        engine.Assign(Arg.Do<FairAssignmentRequest>(request => captured = request))
            .Returns(new FairAssignmentResult([], []));

        var service = new AssignmentGenerationService(
            harness.Households,
            harness.Chores,
            harness.People,
            harness.Completions,
            harness.Assignments,
            engine,
            harness.Clock,
            harness.Gate);
        await service.GenerateAsync(Household, Week29, CancellationToken.None);

        Assert.NotNull(captured);
        return captured!.People.ToDictionary(person => person.PersonId, person => person.TrailingLoad);
    }

    private static AssignmentEntity Existing(string choreId, string personId, string status, string weekIso = Week29) => new()
    {
        PartitionKey = Household,
        RowKey = $"{weekIso}_{choreId}",
        AssignedPersonId = personId,
        WeekIso = weekIso,
        Status = status,
    };

    [Fact]
    public async Task Generate_places_active_chores_and_skips_inactive_ones()
    {
        var harness = new Harness();
        harness.SetChores(
            Chore("chore-a", effort: 5),
            Chore("chore-b", effort: 3),
            Chore("chore-inactive", effort: 9, active: false));
        harness.SetPeople(Person("p1"), Person("p2"));

        var response = await harness.Service.GenerateAsync(Household, weekIso: null, CancellationToken.None);

        Assert.NotNull(response);
        Assert.Equal(Week29, response!.WeekIso);
        Assert.Equal(Week29, response.CurrentWeekIso);
        Assert.Empty(response.Unassigned);

        // Both active chores are placed; the inactive one never is.
        Assert.Equal(
            new List<string> { "chore-a", "chore-b" },
            response.Assignments.Select(a => a.ChoreId).ToList());
        Assert.All(response.Assignments, a => Assert.Equal(AssignmentStatus.Open, a.Status));

        // Two rows added, none for the inactive chore.
        await harness.Assignments.Received(2).AddAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<CancellationToken>());
        await harness.Assignments.DidNotReceive().AddAsync(
            Household,
            Arg.Is<AssignmentEntity>(e => e.RowKey.EndsWith("_chore-inactive", StringComparison.Ordinal)),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Generate_balances_the_two_chores_across_the_two_people()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 5), Chore("chore-b", effort: 3));
        harness.SetPeople(Person("p1"), Person("p2"));

        var response = await harness.Service.GenerateAsync(Household, weekIso: null, CancellationToken.None);

        // Highest-effort chore-a goes first (to p1 on the id tie-break); chore-b then
        // goes to the now-lower-loaded p2 - one chore each.
        Assert.NotNull(response);
        var byChore = response!.Assignments.ToDictionary(a => a.ChoreId, a => a.AssignedPersonId);
        Assert.Equal("p1", byChore["chore-a"]);
        Assert.Equal("p2", byChore["chore-b"]);
    }

    [Fact]
    public async Task Generate_excludes_organizers_from_assignment_and_the_distribution()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 5));

        // The organizer's id sorts before the participant's, so if organizers were
        // candidates the engine's lowest-id tie-break would hand them the chore.
        // The filter must keep the organizer out entirely: the chore goes to p1 and
        // the organizer is never placed.
        harness.SetPeople(Organizer("aaa-organizer"), Person("p1"));

        var response = await harness.Service.GenerateAsync(Household, weekIso: null, CancellationToken.None);

        Assert.NotNull(response);
        var placement = Assert.Single(response!.Assignments);
        Assert.Equal("chore-a", placement.ChoreId);
        Assert.Equal("p1", placement.AssignedPersonId);

        // No row is ever persisted against the organizer, and nothing is left
        // unassigned - the participant absorbs the whole week.
        Assert.Empty(response.Unassigned);
        await harness.Assignments.DidNotReceive().AddAsync(
            Household,
            Arg.Is<AssignmentEntity>(e => e.AssignedPersonId == "aaa-organizer"),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Generate_surfaces_a_chore_no_one_is_eligible_for_with_its_reason()
    {
        var harness = new Harness();
        // The only person is a child; age-gated chores have no eligible taker.
        harness.SetChores(
            Chore("chore-z-adult", effort: 4, minAge: 18),
            Chore("chore-a-adult", effort: 2, minAge: 21));
        harness.SetPeople(Person("kid", isChild: true));

        var response = await harness.Service.GenerateAsync(Household, weekIso: null, CancellationToken.None);

        Assert.NotNull(response);
        Assert.Empty(response!.Assignments);

        // Both surface as unassigned with the reason code, ordered by chore id.
        Assert.Equal(
            new List<string> { "chore-a-adult", "chore-z-adult" },
            response.Unassigned.Select(u => u.ChoreId).ToList());
        Assert.All(
            response.Unassigned,
            u => Assert.Equal(UnassignedReasons.NoEligiblePerson, u.Reason));

        // Nothing was persisted for an unassignable chore.
        await harness.Assignments.DidNotReceive().AddAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Regenerate_preserves_done_and_replaces_open()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-done", effort: 4), Chore("chore-open", effort: 3));
        harness.SetPeople(Person("p1"), Person("p2"));

        // The week already has a completed chore (Done) and an open one, both from p1.
        harness.SetExistingAssignments(
            Existing("chore-done", "p1", AssignmentStatus.Done),
            Existing("chore-open", "p1", AssignmentStatus.Open));

        // p1's completion of chore-done sits in the current week and must feed the
        // recomputed loads so p1 is not handed even more work.
        harness.SetCompletions(Completion("chore-done", "p1", effort: 4, weekIso: Week29));

        var response = await harness.Service.GenerateAsync(Household, weekIso: Week29, CancellationToken.None);

        Assert.NotNull(response);

        // The Done chore is never touched: not re-added, not updated.
        await harness.Assignments.DidNotReceive().AddAsync(
            Household,
            Arg.Is<AssignmentEntity>(e => e.RowKey.EndsWith("_chore-done", StringComparison.Ordinal)),
            Arg.Any<CancellationToken>());
        await harness.Assignments.DidNotReceive().UpdateAsync(
            Household,
            Arg.Is<AssignmentEntity>(e => e.RowKey.EndsWith("_chore-done", StringComparison.Ordinal)),
            Arg.Any<string?>(),
            Arg.Any<CancellationToken>());

        // The Open chore is replaced in place - updated, not added - and rebalanced
        // to p2, since p1 already carries the completed chore-done effort.
        await harness.Assignments.Received(1).UpdateAsync(
            Household,
            Arg.Is<AssignmentEntity>(e =>
                e.RowKey == $"{Week29}_chore-open" &&
                e.AssignedPersonId == "p2" &&
                e.Status == AssignmentStatus.Open),
            OptimisticConcurrency.Wildcard,
            Arg.Any<CancellationToken>());
        await harness.Assignments.DidNotReceive().AddAsync(
            Household,
            Arg.Is<AssignmentEntity>(e => e.RowKey.EndsWith("_chore-open", StringComparison.Ordinal)),
            Arg.Any<CancellationToken>());

        // The response reflects the whole week: the preserved Done plus the new Open.
        var done = Assert.Single(response!.Assignments, a => a.ChoreId == "chore-done");
        Assert.Equal(AssignmentStatus.Done, done.Status);
        Assert.Equal("p1", done.AssignedPersonId);

        var open = Assert.Single(response.Assignments, a => a.ChoreId == "chore-open");
        Assert.Equal(AssignmentStatus.Open, open.Status);
        Assert.Equal("p2", open.AssignedPersonId);
    }

    [Fact]
    public async Task Generate_uses_the_injected_clock_week_when_none_is_supplied()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 2));
        harness.SetPeople(Person("p1"));

        var response = await harness.Service.GenerateAsync(Household, weekIso: null, CancellationToken.None);

        Assert.NotNull(response);
        Assert.Equal(Week29, response!.WeekIso);
        Assert.Equal(Week29, response.CurrentWeekIso);
        await harness.Assignments.Received(1).AddAsync(
            Household,
            Arg.Is<AssignmentEntity>(e => e.WeekIso == Week29 && e.RowKey == $"{Week29}_chore-a"),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Generate_honours_an_explicitly_supplied_week()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 2));
        harness.SetPeople(Person("p1"));

        var response = await harness.Service.GenerateAsync(Household, "2026-W30", CancellationToken.None);

        Assert.NotNull(response);
        Assert.Equal("2026-W30", response!.WeekIso);

        // The server's own week rides along, even when another week was asked for.
        Assert.Equal(Week29, response.CurrentWeekIso);
        await harness.Assignments.Received(1).AddAsync(
            Household,
            Arg.Is<AssignmentEntity>(e => e.WeekIso == "2026-W30"),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Generate_sets_the_due_date_to_the_sunday_of_the_week()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 2));
        harness.SetPeople(Person("p1"));

        await harness.Service.GenerateAsync(Household, Week29, CancellationToken.None);

        // 2026-W29 ends Sunday 2026-07-19; the weekly chore is due 23:59 UTC that day.
        await harness.Assignments.Received(1).AddAsync(
            Household,
            Arg.Is<AssignmentEntity>(e =>
                e.DueDateUtc == new DateTimeOffset(2026, 7, 19, 23, 59, 0, TimeSpan.Zero)),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Trailing_load_ignores_completions_older_than_four_weeks()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 2));
        harness.SetPeople(Person("p1"), Person("p2"));

        // A large p1 completion five weeks before the target week is outside the
        // trailing window, so it must not tip the balance: with equal (zero) loads
        // the single chore goes to the lowest id, p1.
        var monday = WeekIso.StartOfWeekUtc(Week29);
        var fiveWeeksBack = WeekIso.For(monday.AddDays(-7 * 4));
        harness.SetCompletions(Completion("old", "p1", effort: 100, weekIso: fiveWeeksBack));

        var response = await harness.Service.GenerateAsync(Household, Week29, CancellationToken.None);

        Assert.NotNull(response);
        Assert.Equal("p1", Assert.Single(response!.Assignments).AssignedPersonId);
    }

    [Fact]
    public async Task Trailing_load_counts_completions_inside_the_four_week_window()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 2));
        harness.SetPeople(Person("p1"), Person("p2"));

        // A p1 completion three weeks before the target week is inside the window,
        // so p1 carries load and the single chore is rebalanced to p2.
        var monday = WeekIso.StartOfWeekUtc(Week29);
        var threeWeeksBack = WeekIso.For(monday.AddDays(-7 * 3));
        harness.SetCompletions(Completion("recent", "p1", effort: 100, weekIso: threeWeeksBack));

        var response = await harness.Service.GenerateAsync(Household, Week29, CancellationToken.None);

        Assert.NotNull(response);
        Assert.Equal("p2", Assert.Single(response!.Assignments).AssignedPersonId);
    }

    [Fact]
    public async Task Trailing_load_credits_a_cross_person_undo_back_to_the_completer()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 2));
        harness.SetPeople(Person("p1"), Person("p2"));

        // p1 completed plants (1) and dishes (3), p2 completed trash (2), then p2
        // undid p1's dishes. The reversal cancels p1's dishes, so p1 is back to 1
        // and p2 keeps exactly their own 2 - neither is charged the other's effort.
        harness.SetCompletions(
            Completion("plants", "p1", effort: 1, weekIso: Week29),
            Completion("trash", "p2", effort: 2, weekIso: Week29),
            Completion("dishes", "p1", effort: 3, weekIso: Week29),
            Reversal("dishes", "p2", effort: 3, weekIso: Week29));

        var loads = await CapturedTrailingLoadsAsync(harness);

        Assert.Equal(1, loads["p1"]);
        Assert.Equal(2, loads["p2"]);
        Assert.All(loads.Values, load => Assert.True(load >= 0));
    }

    [Fact]
    public async Task Generate_does_not_over_assign_the_undoer_after_a_cross_person_undo()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 2));
        harness.SetPeople(Person("p1"), Person("p2"));

        // p2 undid p1's only completion, so both are back to zero load and the
        // engine's lowest-id tie-break hands the chore to p1. Summing raw rows would
        // leave p1 at 5 and p2 at -5, wrongly piling the chore onto the undoer.
        harness.SetCompletions(
            Completion("dishes", "p1", effort: 5, weekIso: Week29),
            Reversal("dishes", "p2", effort: 5, weekIso: Week29));

        var response = await harness.Service.GenerateAsync(Household, Week29, CancellationToken.None);

        Assert.NotNull(response);
        Assert.Equal("p1", Assert.Single(response!.Assignments).AssignedPersonId);
    }

    [Fact]
    public async Task Trailing_load_nets_an_organizer_undo_before_organizers_are_excluded()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 2));
        harness.SetPeople(Organizer("org-1"), Person("p1"), Person("p2"));

        // The organizer undid p1's completion. The organizer is not a candidate, but
        // the reversal must still cancel p1's effort rather than being lost with
        // the organizer.
        harness.SetCompletions(
            Completion("dishes", "p1", effort: 5, weekIso: Week29),
            Reversal("dishes", "org-1", effort: 5, weekIso: Week29));

        var loads = await CapturedTrailingLoadsAsync(harness);

        Assert.Equal(0, loads["p1"]);
        Assert.Equal(0, loads["p2"]);
        Assert.False(loads.ContainsKey("org-1"));
    }

    [Fact]
    public async Task Trailing_load_drops_an_orphan_reversal_instead_of_going_negative()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 2));
        harness.SetPeople(Person("p1"), Person("p2"));

        // A reversal with no completion to cancel is an orphan and is dropped, so
        // the undoer's load stays at zero instead of going negative.
        harness.SetCompletions(Reversal("dishes", "p2", effort: 3, weekIso: Week29));

        var loads = await CapturedTrailingLoadsAsync(harness);

        Assert.Equal(0, loads["p1"]);
        Assert.Equal(0, loads["p2"]);
    }

    [Fact]
    public async Task Generate_returns_null_for_an_unknown_household()
    {
        var harness = new Harness();
        harness.Households.GetAsync(Household, Arg.Any<CancellationToken>())
            .Returns((HouseholdEntity?)null);

        var response = await harness.Service.GenerateAsync(Household, weekIso: null, CancellationToken.None);

        Assert.Null(response);
        await harness.Assignments.DidNotReceive().AddAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Generate_rejects_a_malformed_week()
    {
        var harness = new Harness();

        await Assert.ThrowsAsync<ValidationException>(
            () => harness.Service.GenerateAsync(Household, "not-a-week", CancellationToken.None));
    }

    [Fact]
    public async Task Generate_rejects_a_blank_household()
    {
        var harness = new Harness();

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => harness.Service.GenerateAsync(string.Empty, weekIso: null, CancellationToken.None));
    }

    [Fact]
    public void Constructor_rejects_null_dependencies()
    {
        var engine = new FairAssignmentEngine();
        var clock = new MutableClock(MidWeek29);
        var households = Substitute.For<IHouseholdRepository>();
        var chores = Substitute.For<IChoreRepository>();
        var people = Substitute.For<IPersonRepository>();
        var completions = Substitute.For<IChoreCompletionRepository>();
        var assignments = Substitute.For<IAssignmentRepository>();
        using var gate = new AssignmentGenerationGate();

        Assert.Throws<ArgumentNullException>(() => new AssignmentGenerationService(
            null!, chores, people, completions, assignments, engine, clock, gate));
        Assert.Throws<ArgumentNullException>(() => new AssignmentGenerationService(
            households, null!, people, completions, assignments, engine, clock, gate));
        Assert.Throws<ArgumentNullException>(() => new AssignmentGenerationService(
            households, chores, null!, completions, assignments, engine, clock, gate));
        Assert.Throws<ArgumentNullException>(() => new AssignmentGenerationService(
            households, chores, people, null!, assignments, engine, clock, gate));
        Assert.Throws<ArgumentNullException>(() => new AssignmentGenerationService(
            households, chores, people, completions, null!, engine, clock, gate));
        Assert.Throws<ArgumentNullException>(() => new AssignmentGenerationService(
            households, chores, people, completions, assignments, null!, clock, gate));
        Assert.Throws<ArgumentNullException>(() => new AssignmentGenerationService(
            households, chores, people, completions, assignments, engine, null!, gate));
        Assert.Throws<ArgumentNullException>(() => new AssignmentGenerationService(
            households, chores, people, completions, assignments, engine, clock, null!));
    }

    // ---- GetOrGenerateAsync: the board's lazy read (#110) ----

    [Fact]
    public async Task GetOrGenerate_generates_an_empty_current_week()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 5), Chore("chore-b", effort: 3));
        harness.SetPeople(Person("p1"), Person("p2"));

        var response = await harness.Service.GetOrGenerateAsync(Household, Week29, CancellationToken.None);

        Assert.NotNull(response);
        Assert.Equal(Week29, response!.WeekIso);
        Assert.Equal(Week29, response.CurrentWeekIso);
        Assert.Equal(
            new List<string> { "chore-a", "chore-b" },
            response.Assignments.Select(a => a.ChoreId).ToList());
        await harness.Assignments.Received(2).AddAsync(
            Household,
            Arg.Is<AssignmentEntity>(e => e.WeekIso == Week29),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetOrGenerate_returns_a_stored_week_without_writing()
    {
        var harness = new Harness();
        harness.SetChores(
            Chore("chore-done", effort: 4),
            Chore("chore-open", effort: 2),
            Chore("chore-retired", effort: 7, active: false));
        harness.SetPeople(Person("p1"), Person("p2"));
        harness.SetExistingAssignments(
            Existing("chore-open", "p2", AssignmentStatus.Open),
            Existing("chore-done", "p1", AssignmentStatus.Done),
            Existing("chore-retired", "p1", AssignmentStatus.Open),
            Existing("chore-deleted-done", "p2", AssignmentStatus.Done),
            Existing("chore-deleted-open", "p2", AssignmentStatus.Open),
            Existing("chore-open", "p1", AssignmentStatus.Open, weekIso: "2026-W28"));

        var response = await harness.Service.GetOrGenerateAsync(Household, Week29, CancellationToken.None);

        Assert.NotNull(response);
        Assert.Equal(Week29, response!.WeekIso);
        Assert.Equal(Week29, response.CurrentWeekIso);

        // Done rows always show (effort 0 once the chore is gone); Open rows only
        // for chores that are still active; another week's rows never.
        Assert.Equal(
            new List<AssignmentView>
            {
                new("chore-deleted-done", "p2", 0, AssignmentStatus.Done),
                new("chore-done", "p1", 4, AssignmentStatus.Done),
                new("chore-open", "p2", 2, AssignmentStatus.Open),
            },
            response.Assignments.ToList());
        Assert.Empty(response.Unassigned);

        await harness.Assignments.DidNotReceive().AddAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<CancellationToken>());
        await harness.Assignments.DidNotReceive().UpdateAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("2026-W28")]
    [InlineData("2026-W30")]
    public async Task GetOrGenerate_never_generates_a_past_or_future_week(string week)
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 5));
        harness.SetPeople(Person("p1"));

        var response = await harness.Service.GetOrGenerateAsync(Household, week, CancellationToken.None);

        Assert.NotNull(response);
        Assert.Equal(week, response!.WeekIso);
        Assert.Equal(Week29, response.CurrentWeekIso);
        Assert.Empty(response.Assignments);
        Assert.Empty(response.Unassigned);
        await harness.Assignments.DidNotReceive().AddAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetOrGenerate_returns_null_for_an_unknown_household()
    {
        var harness = new Harness();
        harness.Households.GetAsync(Household, Arg.Any<CancellationToken>())
            .Returns((HouseholdEntity?)null);

        var response = await harness.Service.GetOrGenerateAsync(Household, Week29, CancellationToken.None);

        Assert.Null(response);
        await harness.Assignments.DidNotReceive().AddAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetOrGenerate_rejects_a_malformed_week()
    {
        var harness = new Harness();

        await Assert.ThrowsAsync<ValidationException>(
            () => harness.Service.GetOrGenerateAsync(Household, "not-a-week", CancellationToken.None));
    }

    [Fact]
    public async Task GetOrGenerate_rejects_a_blank_household()
    {
        var harness = new Harness();

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => harness.Service.GetOrGenerateAsync(string.Empty, Week29, CancellationToken.None));
    }

    [Fact]
    public async Task GetOrGenerate_with_no_active_chores_persists_nothing()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-retired", effort: 3, active: false));
        harness.SetPeople(Person("p1"));

        var response = await harness.Service.GetOrGenerateAsync(Household, Week29, CancellationToken.None);

        Assert.NotNull(response);
        Assert.Empty(response!.Assignments);
        Assert.Empty(response.Unassigned);
        await harness.Assignments.DidNotReceive().AddAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetOrGenerate_with_no_eligible_members_persists_nothing()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 3));
        harness.SetPeople(Organizer("org-1"));

        var response = await harness.Service.GetOrGenerateAsync(Household, Week29, CancellationToken.None);

        // Nothing is placed or persisted; the unplaced chore is surfaced with its
        // reason exactly as POST generate surfaces it.
        Assert.NotNull(response);
        Assert.Empty(response!.Assignments);
        Assert.Equal("chore-a", Assert.Single(response.Unassigned).ChoreId);
        await harness.Assignments.DidNotReceive().AddAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetOrGenerate_returns_the_winners_set_when_the_week_filled_while_waiting()
    {
        var harness = new Harness();
        harness.SetChores(Chore("chore-a", effort: 5));
        harness.SetPeople(Person("p1"));

        // The pre-lock read sees an empty week; the re-read inside the lock sees
        // the set another reader persisted meanwhile.
        harness.Assignments.ListAsync(Household, Arg.Any<CancellationToken>())
            .Returns(
                Array.Empty<AssignmentEntity>(),
                new[] { Existing("chore-a", "p1", AssignmentStatus.Open) });

        var response = await harness.Service.GetOrGenerateAsync(Household, Week29, CancellationToken.None);

        Assert.NotNull(response);
        Assert.Equal(
            new AssignmentView("chore-a", "p1", 5, AssignmentStatus.Open),
            Assert.Single(response!.Assignments));
        await harness.Assignments.DidNotReceive().AddAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<CancellationToken>());
        await harness.Assignments.DidNotReceive().UpdateAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Concurrent_first_reads_add_each_row_once()
    {
        // Two service instances (two requests) over one shared gate and one shared
        // backing table. Both pre-lock reads see the empty week before either
        // enters the lock, so only the in-lock re-read can stop the second one.
        var first = new Harness();
        var second = new Harness();
        var shared = new BarrierAssignmentRepository(pendingReaders: 2);
        foreach (var harness in new[] { first, second })
        {
            harness.SetChores(Chore("chore-a", effort: 5), Chore("chore-b", effort: 3));
            harness.SetPeople(Person("p1"), Person("p2"));
        }

        using var gate = new AssignmentGenerationGate();
        AssignmentGenerationService ServiceOver(Harness harness) => new(
            harness.Households,
            harness.Chores,
            harness.People,
            harness.Completions,
            shared,
            new FairAssignmentEngine(),
            harness.Clock,
            gate);

        var results = await Task.WhenAll(
            ServiceOver(first).GetOrGenerateAsync(Household, Week29, CancellationToken.None),
            ServiceOver(second).GetOrGenerateAsync(Household, Week29, CancellationToken.None));

        Assert.Equal(2, shared.Adds);
        Assert.Equal(
            new[] { $"{Week29}_chore-a", $"{Week29}_chore-b" },
            shared.Rows.Select(row => row.RowKey).Order(StringComparer.Ordinal).ToArray());
        Assert.All(results, response => Assert.Equal(
            new List<string> { "chore-a", "chore-b" },
            response!.Assignments.Select(a => a.ChoreId).ToList()));
    }

    // A shared in-memory assignments table whose first N ListAsync calls wait for
    // each other, so N concurrent readers all observe the empty week before any
    // of them writes. AddAsync throws on a duplicate RowKey, like the real table.
    private sealed class BarrierAssignmentRepository : IAssignmentRepository
    {
        private readonly object _sync = new();
        private readonly List<AssignmentEntity> _rows = [];
        private readonly TaskCompletionSource _allArrived = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _pendingReaders;

        public BarrierAssignmentRepository(int pendingReaders) => _pendingReaders = pendingReaders;

        public int Adds { get; private set; }

        public IReadOnlyList<AssignmentEntity> Rows
        {
            get
            {
                lock (_sync)
                {
                    return [.. _rows];
                }
            }
        }

        public Task AddAsync(string householdId, AssignmentEntity assignment, CancellationToken cancellationToken = default)
        {
            lock (_sync)
            {
                if (_rows.Any(row => row.RowKey == assignment.RowKey))
                {
                    throw new InvalidOperationException($"Duplicate RowKey '{assignment.RowKey}'.");
                }

                _rows.Add(assignment);
                Adds++;
            }

            return Task.CompletedTask;
        }

        public Task<AssignmentEntity?> GetAsync(string householdId, string rowKey, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public async Task<IReadOnlyList<AssignmentEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default)
        {
            IReadOnlyList<AssignmentEntity> snapshot;
            bool wait;
            lock (_sync)
            {
                snapshot = [.. _rows];
                wait = _pendingReaders > 0;
                if (wait && --_pendingReaders == 0)
                {
                    _allArrived.SetResult();
                }
            }

            if (wait)
            {
                await _allArrived.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken).ConfigureAwait(false);
            }

            return snapshot;
        }

        public Task UpdateAsync(string householdId, AssignmentEntity assignment, string? ifMatch, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
