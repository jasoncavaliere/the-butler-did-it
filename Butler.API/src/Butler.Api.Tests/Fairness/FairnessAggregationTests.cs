using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Fairness;
using Butler.Api.Domain.Scheduling;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.People;
using Butler.Api.Tests.TestSupport;
using NSubstitute;

namespace Butler.Api.Tests.Fairness;

/// <summary>
/// Criteria (C6): the fairness service aggregates completed <c>Effort</c> per
/// person over a trailing ISO-week window - reading only the household's
/// <c>ChoreCompletions</c> partition - and returns each person's total and share
/// of the household total. The share math is correct and total-safe: shares sum
/// to ~100 percent when there is at least one completion, and a zero-completion
/// window returns a well-formed zero result (no divide-by-zero). An unknown
/// household is a <c>null</c> (the controller's 404), and a non-positive window
/// is a validation error. Repositories are NSubstitute fakes and the clock is
/// fixed, so every assertion is deterministic.
/// </summary>
public sealed class FairnessAggregationTests
{
    private const string Household = "house-1";

    // A fixed instant inside ISO week 2026-W29 (Wednesday 2026-07-15 09:00 UTC).
    private static readonly DateTimeOffset MidWeek29 = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);

    private static readonly string Week29 = WeekIso.For(MidWeek29);
    private static readonly string Week28 = WeekIso.For(MidWeek29.AddDays(-7));
    private static readonly string Week24 = WeekIso.For(MidWeek29.AddDays(-7 * 5));

    private sealed class Harness
    {
        public IHouseholdRepository Households { get; } = Substitute.For<IHouseholdRepository>();

        public IChoreCompletionRepository Completions { get; } = Substitute.For<IChoreCompletionRepository>();

        public IPersonRepository People { get; } = Substitute.For<IPersonRepository>();

        public MutableClock Clock { get; } = new(MidWeek29);

        public FairnessService Service => new(Households, Completions, People, Clock);

        public Harness()
        {
            Households.GetAsync(Household, Arg.Any<CancellationToken>())
                .Returns(new HouseholdEntity { PartitionKey = Household, RowKey = Household, Name = "Home" });
            Completions.ListAsync(Household, Arg.Any<CancellationToken>())
                .Returns(Array.Empty<ChoreCompletionEntity>());
            People.ListAsync(Household, Arg.Any<CancellationToken>())
                .Returns(Array.Empty<PersonEntity>());
        }

        public void SetCompletions(params ChoreCompletionEntity[] completions) =>
            Completions.ListAsync(Household, Arg.Any<CancellationToken>()).Returns(completions);

        public void SetPeople(params PersonEntity[] people) =>
            People.ListAsync(Household, Arg.Any<CancellationToken>()).Returns(people);
    }

    private static ChoreCompletionEntity Completion(string personId, int effort, string weekIso) => new()
    {
        PartitionKey = Household,
        RowKey = $"{Guid.NewGuid():N}_{personId}",
        PersonId = personId,
        Effort = effort,
        WeekIso = weekIso,
        CompletedUtc = MidWeek29,
    };

    private static PersonEntity Person(string personId, string displayName) => new()
    {
        PartitionKey = Household,
        RowKey = personId,
        DisplayName = displayName,
        Role = "Participant",
    };

    private static PersonEntity Organizer(string personId, string displayName) => new()
    {
        PartitionKey = Household,
        RowKey = personId,
        DisplayName = displayName,
        Role = "Organizer",
    };

    [Fact]
    public async Task Computes_per_person_effort_and_shares_that_sum_to_one_hundred_percent()
    {
        var harness = new Harness();
        harness.SetPeople(Person("p1", "Alex"), Person("p2", "Sam"));
        harness.SetCompletions(
            Completion("p1", 3, Week29),
            Completion("p1", 1, Week28),
            Completion("p2", 2, Week29)); // p1: 4, p2: 2, total 6

        var result = await harness.Service.GetAsync(Household, 4, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(6, result!.TotalEffort);
        Assert.Equal(4, result.WindowWeeks);
        Assert.Equal(Week29, result.WindowEndWeekIso);

        // Ordered by effort descending: Alex (4) then Sam (2).
        Assert.Equal("p1", result.Shares[0].PersonId);
        Assert.Equal("p2", result.Shares[1].PersonId);
        var alex = result.Shares[0];
        var sam = result.Shares[1];
        Assert.Equal(4, alex.TotalEffort);
        Assert.Equal("Alex", alex.DisplayName);
        Assert.Equal(4d / 6d, alex.Share, 10);
        Assert.Equal(2, sam.TotalEffort);
        Assert.Equal(2d / 6d, sam.Share, 10);

        // Shares sum to 1.0 (100 percent) within rounding, and the percentages
        // sum to ~100 as well.
        Assert.Equal(1.0d, result.Shares.Sum(s => s.Share), 9);
        Assert.InRange(result.Shares.Sum(s => s.SharePercent), 99.5d, 100.5d);

        // The top contributor is the greatest-effort person.
        Assert.Equal("p1", result.TopContributorPersonId);
    }

    [Fact]
    public async Task Zero_completion_window_returns_a_safe_zero_result()
    {
        var harness = new Harness();
        harness.SetPeople(Person("p1", "Alex"), Person("p2", "Sam"));
        // No completions at all.

        var result = await harness.Service.GetAsync(Household, 4, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(0, result!.TotalEffort);
        Assert.Null(result.TopContributorPersonId);

        // Every roster member is still present, each with a zero share - a
        // well-formed empty result, never a divide-by-zero.
        Assert.Equal(2, result.Shares.Count);
        Assert.All(result.Shares, s =>
        {
            Assert.Equal(0, s.TotalEffort);
            Assert.Equal(0d, s.Share);
            Assert.Equal(0d, s.SharePercent);
        });
    }

    [Fact]
    public async Task Only_completions_inside_the_window_are_counted()
    {
        var harness = new Harness();
        harness.SetPeople(Person("p1", "Alex"));
        harness.SetCompletions(
            Completion("p1", 5, Week29),  // in the 4-week window
            Completion("p1", 9, Week24)); // 5 weeks back - outside a 4-week window

        var result = await harness.Service.GetAsync(Household, 4, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(5, result!.TotalEffort);
        Assert.Equal(Week29, result.WindowEndWeekIso);
        Assert.Equal(Week24, WeekIso.For(MidWeek29.AddDays(-7 * 5)));
    }

    [Fact]
    public async Task A_narrower_window_excludes_older_weeks()
    {
        var harness = new Harness();
        harness.SetPeople(Person("p1", "Alex"));
        harness.SetCompletions(
            Completion("p1", 5, Week29),
            Completion("p1", 7, Week28));

        // A 1-week window counts only the current week.
        var result = await harness.Service.GetAsync(Household, 1, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(5, result!.TotalEffort);
        Assert.Equal(Week29, result.WindowStartWeekIso);
        Assert.Equal(Week29, result.WindowEndWeekIso);
    }

    [Fact]
    public async Task A_completion_by_a_person_no_longer_on_the_roster_still_counts_with_an_id_fallback()
    {
        var harness = new Harness();
        harness.SetPeople(Person("p1", "Alex"));
        harness.SetCompletions(
            Completion("p1", 2, Week29),
            Completion("ghost", 4, Week29)); // no roster row for "ghost"

        var result = await harness.Service.GetAsync(Household, 4, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(6, result!.TotalEffort);
        var ghost = result.Shares.Single(s => s.PersonId == "ghost");
        Assert.Equal("ghost", ghost.DisplayName); // falls back to the id
        Assert.Equal(4, ghost.TotalEffort);
        // Ghost (4) out-contributed Alex (2), so ghost is the top contributor.
        Assert.Equal("ghost", result.TopContributorPersonId);
    }

    [Fact]
    public async Task Organizers_never_appear_in_the_balance_even_with_a_zero_share()
    {
        var harness = new Harness();
        // A seeded organizer (like the dev organizer) plus one chore-doing member.
        harness.SetPeople(
            Organizer("org-1", "Development Organizer"),
            Person("p1", "Alex"));
        harness.SetCompletions(Completion("p1", 5, Week29));

        var result = await harness.Service.GetAsync(Household, 4, CancellationToken.None);

        Assert.NotNull(result);
        // The organizer is never a row on the board - not even a zero-effort one.
        Assert.DoesNotContain(result!.Shares, s => s.PersonId == "org-1");
        Assert.DoesNotContain(result.Shares, s => s.DisplayName == "Development Organizer");
        Assert.Equal("p1", Assert.Single(result.Shares).PersonId);
        Assert.Equal(5, result.TotalEffort);
        Assert.Equal("p1", result.TopContributorPersonId);
    }

    [Fact]
    public async Task An_organizers_ledger_effort_is_excluded_from_the_household_total()
    {
        var harness = new Harness();
        harness.SetPeople(
            Organizer("org-1", "Development Organizer"),
            Person("p1", "Alex"));
        // Even if the ledger somehow attributes a completion to an organizer, it is
        // not part of the shared load and must not inflate the total or shares.
        harness.SetCompletions(
            Completion("p1", 4, Week29),
            Completion("org-1", 6, Week29));

        var result = await harness.Service.GetAsync(Household, 4, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(4, result!.TotalEffort);
        Assert.DoesNotContain(result.Shares, s => s.PersonId == "org-1");
        var alex = Assert.Single(result.Shares);
        Assert.Equal("p1", alex.PersonId);
        Assert.Equal(1.0d, alex.Share, 9);
    }

    [Fact]
    public async Task Unknown_household_returns_null()
    {
        var harness = new Harness();
        harness.Households.GetAsync(Household, Arg.Any<CancellationToken>())
            .Returns((HouseholdEntity?)null);

        var result = await harness.Service.GetAsync(Household, 4, CancellationToken.None);

        Assert.Null(result);
        // No aggregation work is done once the household is missing.
        await harness.Completions.DidNotReceive().ListAsync(Household, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task A_non_positive_window_is_a_validation_error()
    {
        var harness = new Harness();

        await Assert.ThrowsAsync<ValidationException>(
            () => harness.Service.GetAsync(Household, 0, CancellationToken.None));
        await Assert.ThrowsAsync<ValidationException>(
            () => harness.Service.GetAsync(Household, -1, CancellationToken.None));
    }

    [Fact]
    public async Task Blank_household_is_rejected()
    {
        var harness = new Harness();

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => harness.Service.GetAsync(string.Empty, 4, CancellationToken.None));
    }

    [Fact]
    public void Constructor_rejects_null_dependencies()
    {
        var households = Substitute.For<IHouseholdRepository>();
        var completions = Substitute.For<IChoreCompletionRepository>();
        var people = Substitute.For<IPersonRepository>();
        var clock = new MutableClock(MidWeek29);

        Assert.Throws<ArgumentNullException>(() => new FairnessService(null!, completions, people, clock));
        Assert.Throws<ArgumentNullException>(() => new FairnessService(households, null!, people, clock));
        Assert.Throws<ArgumentNullException>(() => new FairnessService(households, completions, null!, clock));
        Assert.Throws<ArgumentNullException>(() => new FairnessService(households, completions, people, null!));
    }
}
