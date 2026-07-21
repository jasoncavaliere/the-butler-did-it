using Azure;
using Butler.Api.Application.Assignments;
using Butler.Api.Infrastructure.Assignments;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Chores;
using Butler.Api.Tests.TestSupport;
using NSubstitute;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Criteria (C4): the completion service appends an append-only
/// <c>ChoreCompletion</c> (crediting the actor with the chore's effort at the
/// injected clock's instant, in the assignment's week) and flips the matching
/// assignment to <c>Done</c> under optimistic concurrency using the read
/// <c>ETag</c>. An already-<c>Done</c> assignment is an idempotent success no-op
/// that never appends a second completion or mutates the ledger, and an unknown
/// assignment returns <c>null</c> (the controller's <c>404</c>). Repositories are
/// NSubstitute fakes and the clock is fixed, so every assertion is deterministic.
/// </summary>
public sealed class ChoreCompletionServiceTests
{
    private const string Household = "house-1";
    private const string ChoreId = "chore-a";
    private const string PersonId = "person-1";
    private const string Week29 = "2026-W29";
    private static readonly string RowKey = $"{Week29}_{ChoreId}";

    // A fixed instant inside ISO week 2026-W29 (Wednesday 2026-07-15 09:00 UTC).
    private static readonly DateTimeOffset MidWeek29 = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);

    private sealed class Harness
    {
        public IAssignmentRepository Assignments { get; } = Substitute.For<IAssignmentRepository>();

        public IChoreCompletionRepository Completions { get; } = Substitute.For<IChoreCompletionRepository>();

        public IChoreRepository Chores { get; } = Substitute.For<IChoreRepository>();

        public MutableClock Clock { get; } = new(MidWeek29);

        public ChoreCompletionService Service => new(Assignments, Completions, Chores, Clock);

        public Harness()
        {
            Chores.GetAsync(Household, ChoreId, Arg.Any<CancellationToken>())
                .Returns(Chore(ChoreId, effort: 5));
        }

        public void SetAssignment(AssignmentEntity? assignment) =>
            Assignments.GetAsync(Household, RowKey, Arg.Any<CancellationToken>()).Returns(assignment);
    }

    private static AssignmentEntity Assignment(string status, string personId = PersonId) => new()
    {
        PartitionKey = Household,
        RowKey = RowKey,
        AssignedPersonId = personId,
        WeekIso = Week29,
        Status = status,
        ETag = new ETag("etag-v1"),
    };

    private static ChoreEntity Chore(string id, int effort) => new()
    {
        PartitionKey = Household,
        RowKey = id,
        Title = id,
        RoomId = "room-1",
        Cadence = "Weekly",
        Effort = effort,
    };

    [Fact]
    public async Task Complete_sets_done_and_records_a_single_completion()
    {
        var harness = new Harness();
        harness.SetAssignment(Assignment(AssignmentStatus.Open));

        var result = await harness.Service.CompleteAsync(
            Household, Week29, ChoreId, PersonId, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(Week29, result!.WeekIso);
        Assert.Equal(ChoreId, result.ChoreId);
        Assert.Equal(AssignmentStatus.Done, result.Status);

        // Exactly one completion is appended, carrying the chore's effort, the
        // clock's instant, the actor, and the assignment's week.
        await harness.Completions.Received(1).AddAsync(
            Household,
            Arg.Is<ChoreCompletionEntity>(c =>
                c.ChoreId == ChoreId &&
                c.PersonId == PersonId &&
                c.Effort == 5 &&
                c.CompletedUtc == MidWeek29 &&
                c.WeekIso == Week29 &&
                c.RowKey == $"{MidWeek29.UtcTicks}_{ChoreId}"),
            Arg.Any<CancellationToken>());

        // The assignment is flipped to Done under the read ETag as If-Match.
        await harness.Assignments.Received(1).UpdateAsync(
            Household,
            Arg.Is<AssignmentEntity>(a => a.RowKey == RowKey && a.Status == AssignmentStatus.Done),
            "etag-v1",
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Double_complete_is_an_idempotent_success_no_op()
    {
        var harness = new Harness();
        harness.SetAssignment(Assignment(AssignmentStatus.Done));

        var result = await harness.Service.CompleteAsync(
            Household, Week29, ChoreId, PersonId, CancellationToken.None);

        // Success, no exception, and the assignment is reported Done.
        Assert.NotNull(result);
        Assert.Equal(AssignmentStatus.Done, result!.Status);

        // No second completion is appended and the assignment is never re-written.
        await harness.Completions.DidNotReceive().AddAsync(
            Household, Arg.Any<ChoreCompletionEntity>(), Arg.Any<CancellationToken>());
        await harness.Assignments.DidNotReceive().UpdateAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Completion_ledger_is_append_only_on_a_repeat_complete()
    {
        // The append-only guarantee (BRD R-2): a repeat complete of the same chore
        // never deletes or overwrites a prior completion. The seam exposes only
        // AddAsync/GetAsync/ListAsync - there is no update or delete - and an
        // already-Done assignment short-circuits before any append at all.
        var harness = new Harness();
        harness.SetAssignment(Assignment(AssignmentStatus.Done));

        await harness.Service.CompleteAsync(Household, Week29, ChoreId, PersonId, CancellationToken.None);

        // The only interaction with the ledger is the read; nothing is appended,
        // and the interface offers no mutation to call.
        await harness.Completions.DidNotReceive().AddAsync(
            Household, Arg.Any<ChoreCompletionEntity>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Unknown_assignment_returns_null()
    {
        var harness = new Harness();
        harness.SetAssignment(null);

        var result = await harness.Service.CompleteAsync(
            Household, Week29, ChoreId, PersonId, CancellationToken.None);

        Assert.Null(result);
        await harness.Completions.DidNotReceive().AddAsync(
            Household, Arg.Any<ChoreCompletionEntity>(), Arg.Any<CancellationToken>());
        await harness.Assignments.DidNotReceive().UpdateAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Complete_credits_zero_effort_when_the_chore_is_missing()
    {
        // Defensive: the assignment existing implies the chore does, but a missing
        // chore must not fail the completion - it credits no effort.
        var harness = new Harness();
        harness.SetAssignment(Assignment(AssignmentStatus.Open));
        harness.Chores.GetAsync(Household, ChoreId, Arg.Any<CancellationToken>())
            .Returns((ChoreEntity?)null);

        var result = await harness.Service.CompleteAsync(
            Household, Week29, ChoreId, PersonId, CancellationToken.None);

        Assert.NotNull(result);
        await harness.Completions.Received(1).AddAsync(
            Household,
            Arg.Is<ChoreCompletionEntity>(c => c.Effort == 0),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Complete_rejects_blank_arguments()
    {
        var harness = new Harness();

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => harness.Service.CompleteAsync(string.Empty, Week29, ChoreId, PersonId, CancellationToken.None));
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => harness.Service.CompleteAsync(Household, string.Empty, ChoreId, PersonId, CancellationToken.None));
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => harness.Service.CompleteAsync(Household, Week29, string.Empty, PersonId, CancellationToken.None));
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => harness.Service.CompleteAsync(Household, Week29, ChoreId, string.Empty, CancellationToken.None));
    }

    [Fact]
    public async Task Undo_reverses_a_completion()
    {
        // Reverse-a-completion: a Done assignment flips back to Open and a single
        // compensating -effort entry is appended (append-only reversal), so the
        // person's net trailing load returns to its pre-completion value.
        var harness = new Harness();
        harness.SetAssignment(Assignment(AssignmentStatus.Done));

        var result = await harness.Service.UndoAsync(
            Household, Week29, ChoreId, PersonId, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(Week29, result!.WeekIso);
        Assert.Equal(ChoreId, result.ChoreId);
        Assert.Equal(AssignmentStatus.Open, result.Status);

        // Exactly one compensating completion is appended, backing out the chore's
        // effort (negated) for the actor in the assignment's week, under a distinct
        // void row key that cannot collide with the original append.
        await harness.Completions.Received(1).AddAsync(
            Household,
            Arg.Is<ChoreCompletionEntity>(c =>
                c.ChoreId == ChoreId &&
                c.PersonId == PersonId &&
                c.Effort == -5 &&
                c.CompletedUtc == MidWeek29 &&
                c.WeekIso == Week29 &&
                c.RowKey == $"{MidWeek29.UtcTicks}_{ChoreId}_void"),
            Arg.Any<CancellationToken>());

        // The assignment is flipped back to Open under the read ETag as If-Match.
        await harness.Assignments.Received(1).UpdateAsync(
            Household,
            Arg.Is<AssignmentEntity>(a => a.RowKey == RowKey && a.Status == AssignmentStatus.Open),
            "etag-v1",
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Undo_is_idempotent_when_already_open()
    {
        // Undo-is-idempotent: undoing an assignment that is already Open (or was
        // never completed) is a success no-op that appends nothing and never
        // re-writes the assignment, so effort is never double-subtracted.
        var harness = new Harness();
        harness.SetAssignment(Assignment(AssignmentStatus.Open));

        var result = await harness.Service.UndoAsync(
            Household, Week29, ChoreId, PersonId, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(AssignmentStatus.Open, result!.Status);

        await harness.Completions.DidNotReceive().AddAsync(
            Household, Arg.Any<ChoreCompletionEntity>(), Arg.Any<CancellationToken>());
        await harness.Assignments.DidNotReceive().UpdateAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Undo_unknown_assignment_returns_null()
    {
        var harness = new Harness();
        harness.SetAssignment(null);

        var result = await harness.Service.UndoAsync(
            Household, Week29, ChoreId, PersonId, CancellationToken.None);

        Assert.Null(result);
        await harness.Completions.DidNotReceive().AddAsync(
            Household, Arg.Any<ChoreCompletionEntity>(), Arg.Any<CancellationToken>());
        await harness.Assignments.DidNotReceive().UpdateAsync(
            Household, Arg.Any<AssignmentEntity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Undo_credits_zero_effort_when_the_chore_is_missing()
    {
        // Defensive: a missing chore must not fail the undo - it backs out no effort.
        var harness = new Harness();
        harness.SetAssignment(Assignment(AssignmentStatus.Done));
        harness.Chores.GetAsync(Household, ChoreId, Arg.Any<CancellationToken>())
            .Returns((ChoreEntity?)null);

        var result = await harness.Service.UndoAsync(
            Household, Week29, ChoreId, PersonId, CancellationToken.None);

        Assert.NotNull(result);
        await harness.Completions.Received(1).AddAsync(
            Household,
            Arg.Is<ChoreCompletionEntity>(c => c.Effort == 0),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Undo_rejects_blank_arguments()
    {
        var harness = new Harness();

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => harness.Service.UndoAsync(string.Empty, Week29, ChoreId, PersonId, CancellationToken.None));
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => harness.Service.UndoAsync(Household, string.Empty, ChoreId, PersonId, CancellationToken.None));
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => harness.Service.UndoAsync(Household, Week29, string.Empty, PersonId, CancellationToken.None));
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => harness.Service.UndoAsync(Household, Week29, ChoreId, string.Empty, CancellationToken.None));
    }

    [Fact]
    public void Constructor_rejects_null_dependencies()
    {
        var assignments = Substitute.For<IAssignmentRepository>();
        var completions = Substitute.For<IChoreCompletionRepository>();
        var chores = Substitute.For<IChoreRepository>();
        var clock = new MutableClock(MidWeek29);

        Assert.Throws<ArgumentNullException>(() => new ChoreCompletionService(null!, completions, chores, clock));
        Assert.Throws<ArgumentNullException>(() => new ChoreCompletionService(assignments, null!, chores, clock));
        Assert.Throws<ArgumentNullException>(() => new ChoreCompletionService(assignments, completions, null!, clock));
        Assert.Throws<ArgumentNullException>(() => new ChoreCompletionService(assignments, completions, chores, null!));
    }
}
