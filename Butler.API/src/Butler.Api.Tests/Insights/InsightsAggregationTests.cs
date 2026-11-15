using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Events;
using Butler.Api.Application.Insights;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Events;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.People;
using Butler.Api.Tests.TestSupport;
using NSubstitute;

namespace Butler.Api.Tests.Insights;

/// <summary>
/// Criteria (#123 AC1-AC5): the insights service aggregates, over a trailing
/// ISO-week window anchored to the injected clock, the top contributor's share of
/// effort per week, net completions per member per week, hub glances per UTC day
/// (from the Events table, #122) and confirmed carts per UTC month. A missing or
/// out-of-range window is a validation error (the 400) and an unknown household is
/// a <c>null</c> (the 404). Repositories are NSubstitute fakes and the clock is
/// fixed at Wednesday 2026-07-15 09:00 UTC (W29), so with <c>weeks=3</c> the window
/// is W27 (Monday 2026-06-29) to W29: 17 days and the months 2026-06 and 2026-07.
/// </summary>
public sealed class InsightsAggregationTests
{
    private const string Household = "house-1";
    private const string Week27 = "2026-W27";
    private const string Week28 = "2026-W28";
    private const string Week29 = "2026-W29";
    private const string Week26 = "2026-W26";

    private static readonly string[] P1ThenP2 = ["p1", "p2"];

    private static readonly DateTimeOffset Now = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset WindowStart = new(2026, 6, 29, 0, 0, 0, TimeSpan.Zero);

    private sealed class Harness
    {
        public IHouseholdRepository Households { get; } = Substitute.For<IHouseholdRepository>();

        public IChoreCompletionRepository Completions { get; } = Substitute.For<IChoreCompletionRepository>();

        public IPersonRepository People { get; } = Substitute.For<IPersonRepository>();

        public IEventRepository Events { get; } = Substitute.For<IEventRepository>();

        public ICartRepository Carts { get; } = Substitute.For<ICartRepository>();

        public MutableClock Clock { get; } = new(Now);

        public InsightsService Service => new(Households, Completions, People, Events, Carts, Clock);

        public Harness()
        {
            Households.GetAsync(Household, Arg.Any<CancellationToken>())
                .Returns(new HouseholdEntity { PartitionKey = Household, RowKey = Household, Name = "Home" });
            Completions.ListAsync(Household, Arg.Any<CancellationToken>())
                .Returns(Array.Empty<ChoreCompletionEntity>());
            People.ListAsync(Household, Arg.Any<CancellationToken>())
                .Returns(Array.Empty<PersonEntity>());
            Events.ListAsync(Household, Arg.Any<CancellationToken>())
                .Returns(Array.Empty<EventEntity>());
            Carts.ListAsync(Household, Arg.Any<CancellationToken>())
                .Returns(Array.Empty<CartEntity>());
        }

        public void SetCompletions(params ChoreCompletionEntity[] rows) =>
            Completions.ListAsync(Household, Arg.Any<CancellationToken>()).Returns(rows);

        public void SetPeople(params PersonEntity[] people) =>
            People.ListAsync(Household, Arg.Any<CancellationToken>()).Returns(people);

        public void SetEvents(params EventEntity[] events) =>
            Events.ListAsync(Household, Arg.Any<CancellationToken>()).Returns(events);

        public void SetCarts(params CartEntity[] carts) =>
            Carts.ListAsync(Household, Arg.Any<CancellationToken>()).Returns(carts);
    }

    private static ChoreCompletionEntity Completion(
        string personId, int effort, string weekIso, string choreId = "c1", DateTimeOffset? completedUtc = null) => new()
    {
        PartitionKey = Household,
        RowKey = $"{Guid.NewGuid():N}_{choreId}",
        ChoreId = choreId,
        PersonId = personId,
        Effort = effort,
        WeekIso = weekIso,
        CompletedUtc = completedUtc ?? Now,
    };

    private static ChoreCompletionEntity Reversal(
        string personId, int effort, string weekIso, string choreId = "c1", DateTimeOffset? completedUtc = null) => new()
    {
        PartitionKey = Household,
        RowKey = $"{Guid.NewGuid():N}_{choreId}_void",
        ChoreId = choreId,
        PersonId = personId,
        Effort = -effort,
        WeekIso = weekIso,
        CompletedUtc = completedUtc ?? Now,
    };

    private static PersonEntity Person(string personId, string displayName, string? claimColor = null) => new()
    {
        PartitionKey = Household,
        RowKey = personId,
        DisplayName = displayName,
        Role = "Participant",
        ClaimColor = claimColor,
    };

    private static PersonEntity Organizer(string personId, string displayName) => new()
    {
        PartitionKey = Household,
        RowKey = personId,
        DisplayName = displayName,
        Role = "Organizer",
    };

    private static EventEntity Event(string type, DateTimeOffset occurredUtc) => new()
    {
        PartitionKey = Household,
        RowKey = $"{occurredUtc.UtcTicks:D19}_{Guid.NewGuid():N}",
        Type = type,
        OccurredUtc = occurredUtc,
    };

    private static EventEntity Glance(DateTimeOffset occurredUtc) => Event(EventTypes.HubGlanced, occurredUtc);

    private static CartEntity Cart(string weekIso, string status, DateTimeOffset? confirmedUtc) => new()
    {
        PartitionKey = Household,
        RowKey = weekIso,
        Status = status,
        ConfirmedUtc = confirmedUtc,
    };

    private static int CompletionsFor(WeeklyInsight week, string personId) =>
        week.Completions.Single(entry => entry.PersonId == personId).Completions;

    [Fact]
    public async Task Returns_the_top_contributors_share_of_effort_for_each_week()
    {
        var harness = new Harness();
        harness.SetPeople(Person("p1", "Alex"), Person("p2", "Sam"));
        harness.SetCompletions(
            Completion("p1", 3, Week27),
            Completion("p2", 1, Week27),
            Completion("p2", 4, Week29),
            Completion("p1", 1, Week29));

        var result = await harness.Service.GetAsync(Household, 3);

        Assert.NotNull(result);
        Assert.Equal(Week27, result!.WindowStartWeekIso);
        Assert.Equal(Week29, result.WindowEndWeekIso);
        Assert.Equal(3, result.WindowWeeks);
        Assert.Equal(new[] { Week27, Week28, Week29 }, result.Weeks.Select(w => w.WeekIso));

        var w27 = result.Weeks[0];
        Assert.Equal(4, w27.TotalEffort);
        Assert.Equal("p1", w27.TopContributorPersonId);
        Assert.Equal(0.75d, w27.TopContributorShare, 10);

        // A quiet week has no top contributor and a zero share (total-safe).
        var w28 = result.Weeks[1];
        Assert.Equal(0, w28.TotalEffort);
        Assert.Null(w28.TopContributorPersonId);
        Assert.Equal(0d, w28.TopContributorShare);

        var w29 = result.Weeks[2];
        Assert.Equal("p2", w29.TopContributorPersonId);
        Assert.Equal(0.8d, w29.TopContributorShare, 10);
    }

    [Fact]
    public async Task A_tie_for_top_contributor_goes_to_the_lower_person_id()
    {
        var harness = new Harness();
        harness.SetPeople(Person("p2", "Alex"), Person("p1", "Sam"));
        harness.SetCompletions(Completion("p2", 2, Week29), Completion("p1", 2, Week29));

        var result = await harness.Service.GetAsync(Household, 1);

        var week = Assert.Single(result!.Weeks);
        Assert.Equal("p1", week.TopContributorPersonId);
        Assert.Equal(0.5d, week.TopContributorShare, 10);
    }

    [Fact]
    public async Task Counts_completions_per_member_per_week_net_of_undo()
    {
        var harness = new Harness();
        harness.SetPeople(Person("p1", "Alex"), Person("p2", "Sam"));
        harness.SetCompletions(
            Completion("p1", 2, Week27, "c1"),
            Completion("p1", 2, Week27, "c2"),
            Completion("p2", 3, Week28, "c3"),
            // p2's week-28 completion is undone: the reversal carries the original week.
            Reversal("p2", 3, Week28, "c3"),
            Completion("p2", 1, Week29, "c4"),
            // A stray reversal with no matching completion never drives a count below zero.
            Reversal("p1", 1, Week29, "c5"));

        var result = await harness.Service.GetAsync(Household, 3);

        Assert.NotNull(result);
        Assert.Equal(2, CompletionsFor(result!.Weeks[0], "p1"));
        Assert.Equal(0, CompletionsFor(result.Weeks[0], "p2"));
        Assert.Equal(0, CompletionsFor(result.Weeks[1], "p2"));
        Assert.Equal(0, result.Weeks[1].TotalEffort);
        Assert.Null(result.Weeks[1].TopContributorPersonId);
        Assert.Equal(1, CompletionsFor(result.Weeks[2], "p2"));
        Assert.Equal(0, CompletionsFor(result.Weeks[2], "p1"));

        // Every week lists every member, in member order (zero-filled).
        Assert.All(result.Weeks, week =>
            Assert.Equal(P1ThenP2, week.Completions.Select(entry => entry.PersonId)));
    }

    [Fact]
    public async Task A_stray_reversal_adds_no_negative_effort()
    {
        var harness = new Harness();
        harness.SetPeople(Person("p1", "Alex"));
        harness.SetCompletions(Reversal("p1", 2, Week29));

        var result = await harness.Service.GetAsync(Household, 1);

        var week = Assert.Single(result!.Weeks);
        Assert.Equal(0, week.TotalEffort);
        Assert.Null(week.TopContributorPersonId);
        Assert.Equal(0d, week.TopContributorShare);
        Assert.Equal(0, CompletionsFor(week, "p1"));
    }

    [Fact]
    public async Task A_cross_person_undo_credits_back_the_original_completer()
    {
        // #220: Sam (p2) undoes Alex's (p1) Dishes. The week returns to exactly what
        // it was before Alex completed Dishes: Alex 1 (Plants), Sam 1 (Trash).
        var harness = new Harness();
        harness.SetPeople(Person("p1", "Alex"), Person("p2", "Sam"));
        harness.SetCompletions(
            Completion("p2", 2, Week29, "trash", Now.AddMinutes(1)),
            Completion("p1", 1, Week29, "plants", Now.AddMinutes(2)),
            Completion("p1", 3, Week29, "dishes", Now.AddMinutes(3)),
            Reversal("p2", 3, Week29, "dishes", Now.AddMinutes(4)));

        var result = await harness.Service.GetAsync(Household, 1);

        var week = Assert.Single(result!.Weeks);
        Assert.Equal(1, CompletionsFor(week, "p1"));
        Assert.Equal(1, CompletionsFor(week, "p2"));
        Assert.Equal(3, week.TotalEffort);
        Assert.Equal("p2", week.TopContributorPersonId);
        Assert.Equal(2d / 3d, week.TopContributorShare, 10);
    }

    [Fact]
    public async Task An_organizer_undo_cancels_the_participants_completion()
    {
        // The organizer's reversal is netted before organizers are dropped, so it
        // still cancels the participant's completion instead of being discarded.
        var harness = new Harness();
        harness.SetPeople(Person("p1", "Alex"), Organizer("org", "Owner"));
        harness.SetCompletions(
            Completion("p1", 3, Week29, "dishes", Now.AddMinutes(1)),
            Reversal("org", 3, Week29, "dishes", Now.AddMinutes(2)));

        var result = await harness.Service.GetAsync(Household, 1);

        var week = Assert.Single(result!.Weeks);
        Assert.Equal(0, CompletionsFor(week, "p1"));
        Assert.Equal(0, week.TotalEffort);
        Assert.Null(week.TopContributorPersonId);
        Assert.Equal(0d, week.TopContributorShare);
    }

    [Fact]
    public async Task Every_week_keeps_counts_non_negative_and_the_top_share_within_zero_and_one()
    {
        // A mixed ledger: cross-person undos, organizer undos, orphan reversals and
        // re-completions across three weeks.
        var harness = new Harness();
        harness.SetPeople(Person("p1", "Alex"), Person("p2", "Sam"), Organizer("org", "Owner"));
        harness.SetCompletions(
            Reversal("p1", 5, Week27, "c1", Now.AddMinutes(-10)),
            Completion("p1", 2, Week27, "c2", Now.AddMinutes(1)),
            Reversal("p2", 2, Week27, "c2", Now.AddMinutes(2)),
            Reversal("p2", 2, Week27, "c2", Now.AddMinutes(3)),
            Completion("p2", 4, Week28, "c3", Now.AddMinutes(1)),
            Reversal("org", 4, Week28, "c3", Now.AddMinutes(2)),
            Completion("p1", 4, Week28, "c3", Now.AddMinutes(3)),
            Completion("p2", 1, Week29, "c4", Now.AddMinutes(1)),
            Reversal("p1", 1, Week29, "c4", Now.AddMinutes(2)),
            Completion("p1", 1, Week29, "c4", Now.AddMinutes(3)),
            Reversal("p2", 9, Week29, "c9", Now.AddMinutes(4)));

        var result = await harness.Service.GetAsync(Household, 3);

        Assert.NotNull(result);
        Assert.All(result!.Weeks, week =>
        {
            Assert.All(week.Completions, entry => Assert.True(entry.Completions >= 0));
            Assert.True(week.TotalEffort >= 0);
            Assert.InRange(week.TopContributorShare, 0d, 1d);
        });

        Assert.Equal(0, result.Weeks[0].TotalEffort);
        Assert.Equal(4, result.Weeks[1].TotalEffort);
        Assert.Equal("p1", result.Weeks[1].TopContributorPersonId);
        Assert.Equal(1, CompletionsFor(result.Weeks[2], "p1"));
        Assert.Equal(0, CompletionsFor(result.Weeks[2], "p2"));
        Assert.Equal(1d, result.Weeks[2].TopContributorShare);
    }

    [Fact]
    public async Task Members_exclude_organizers_include_off_roster_people_and_sort_by_name()
    {
        var harness = new Harness();
        harness.SetPeople(
            Person("p1", "Sam", "#FF0000"),
            Person("p2", "Alex"),
            Organizer("org", "Owner"));
        harness.SetCompletions(
            Completion("org", 9, Week29),
            Completion("gone", 1, Week29),
            // Out-of-window rows add neither effort nor an off-roster member.
            Completion("ancient", 5, Week26));

        var result = await harness.Service.GetAsync(Household, 3);

        Assert.NotNull(result);
        // Ordered by display name (ordinal), and the off-roster person's name falls
        // back to the id.
        Assert.Equal(
            new[]
            {
                new InsightsMember("p2", "Alex", null),
                new InsightsMember("p1", "Sam", "#FF0000"),
                new InsightsMember("gone", "gone", null),
            },
            result!.Members);

        // The organizer's effort never counts; the off-roster person is the top contributor.
        var w29 = result.Weeks[2];
        Assert.Equal(1, w29.TotalEffort);
        Assert.Equal("gone", w29.TopContributorPersonId);
        Assert.Equal(1d, w29.TopContributorShare);
        Assert.DoesNotContain(w29.Completions, entry => entry.PersonId == "org");
    }

    [Fact]
    public async Task Members_with_the_same_display_name_sort_by_person_id()
    {
        var harness = new Harness();
        harness.SetPeople(Person("p2", "Alex"), Person("p1", "Alex"));

        var result = await harness.Service.GetAsync(Household, 1);

        Assert.Equal(P1ThenP2, result!.Members.Select(m => m.PersonId));
    }

    [Fact]
    public async Task Counts_hub_glances_per_day_from_the_events_table()
    {
        var harness = new Harness();
        harness.SetEvents(
            Glance(WindowStart),                                   // first day, at midnight
            Glance(WindowStart.AddHours(23)),                      // same first day
            Glance(new DateTimeOffset(2026, 7, 4, 12, 0, 0, TimeSpan.Zero)),
            Glance(Now.AddHours(-1)),                              // today
            Glance(WindowStart.AddTicks(-1)),                      // before the window
            Glance(Now.AddMinutes(1)),                             // in the future
            Event(EventTypes.ChoreCompleted, Now.AddHours(-2)));   // not a glance

        var result = await harness.Service.GetAsync(Household, 3);

        Assert.NotNull(result);
        var days = result!.GlancesPerDay;
        Assert.Equal(17, days.Count);
        Assert.Equal("2026-06-29", days[0].Date);
        Assert.Equal("2026-07-15", days[^1].Date);
        Assert.Equal(2, days[0].Count);
        Assert.Equal(1, days.Single(d => d.Date == "2026-07-04").Count);
        Assert.Equal(1, days[^1].Count);
        Assert.Equal(4, days.Sum(d => d.Count));
    }

    [Fact]
    public async Task Counts_confirmed_carts_per_month_across_the_window()
    {
        var harness = new Harness();
        harness.SetCarts(
            Cart(Week27, CartStatus.Confirmed, new DateTimeOffset(2026, 6, 30, 18, 0, 0, TimeSpan.Zero)),
            Cart(Week28, CartStatus.Confirmed, new DateTimeOffset(2026, 7, 8, 18, 0, 0, TimeSpan.Zero)),
            Cart(Week29, CartStatus.Confirmed, Now.AddHours(-1)),
            // Before the window, a building cart, a confirmed cart with no stamp, and
            // a confirm in the future never count.
            Cart(Week26, CartStatus.Confirmed, WindowStart.AddTicks(-1)),
            Cart("2026-W30", CartStatus.Building, null),
            Cart("2026-W25", CartStatus.Confirmed, null),
            Cart("2026-W31", CartStatus.Confirmed, Now.AddDays(1)));

        var result = await harness.Service.GetAsync(Household, 3);

        Assert.NotNull(result);
        Assert.Equal(
            new[] { new MonthlyCount("2026-06", 1), new MonthlyCount("2026-07", 2) },
            result!.CartsConfirmedPerMonth);
    }

    [Fact]
    public async Task An_empty_household_returns_zero_filled_series()
    {
        var harness = new Harness();

        var result = await harness.Service.GetAsync(Household, 1);

        Assert.NotNull(result);
        Assert.Empty(result!.Members);
        var week = Assert.Single(result.Weeks);
        Assert.Empty(week.Completions);
        Assert.Equal(3, result.GlancesPerDay.Count); // Mon 13 .. Wed 15
        Assert.All(result.GlancesPerDay, day => Assert.Equal(0, day.Count));
        Assert.Equal(new[] { new MonthlyCount("2026-07", 0) }, result.CartsConfirmedPerMonth);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(InsightsService.MaxWeeks + 1)]
    public async Task Rejects_a_missing_or_out_of_range_window(int? weeks)
    {
        var harness = new Harness();

        await Assert.ThrowsAsync<ValidationException>(() => harness.Service.GetAsync(Household, weeks));
    }

    [Fact]
    public async Task Accepts_the_maximum_window()
    {
        var harness = new Harness();

        var result = await harness.Service.GetAsync(Household, InsightsService.MaxWeeks);

        Assert.Equal(InsightsService.MaxWeeks, result!.Weeks.Count);
        Assert.Equal(Week29, result.WindowEndWeekIso);
    }

    [Fact]
    public async Task An_unknown_household_returns_null()
    {
        var harness = new Harness();

        Assert.Null(await harness.Service.GetAsync("missing", 3));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public async Task Rejects_a_blank_household_id(string? householdId)
    {
        var harness = new Harness();

        await Assert.ThrowsAnyAsync<ArgumentException>(() => harness.Service.GetAsync(householdId!, 3));
    }

    [Fact]
    public void Constructor_rejects_null_dependencies()
    {
        var households = Substitute.For<IHouseholdRepository>();
        var completions = Substitute.For<IChoreCompletionRepository>();
        var people = Substitute.For<IPersonRepository>();
        var events = Substitute.For<IEventRepository>();
        var carts = Substitute.For<ICartRepository>();
        var clock = new MutableClock(Now);

        Assert.Throws<ArgumentNullException>(() => new InsightsService(null!, completions, people, events, carts, clock));
        Assert.Throws<ArgumentNullException>(() => new InsightsService(households, null!, people, events, carts, clock));
        Assert.Throws<ArgumentNullException>(() => new InsightsService(households, completions, null!, events, carts, clock));
        Assert.Throws<ArgumentNullException>(() => new InsightsService(households, completions, people, null!, carts, clock));
        Assert.Throws<ArgumentNullException>(() => new InsightsService(households, completions, people, events, null!, clock));
        Assert.Throws<ArgumentNullException>(() => new InsightsService(households, completions, people, events, carts, null!));
    }
}
