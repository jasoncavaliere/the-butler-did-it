using Butler.Api.Application.Auth;
using Butler.Api.Application.Demo;
using Butler.Api.Infrastructure.Assignments;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Chores;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.HubDevices;
using Butler.Api.Infrastructure.People;
using Butler.Api.Infrastructure.Rooms;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Demo;

/// <summary>
/// Criteria (#97 AC1, AC5, AC6, AC8): the demo seeder builds the whole Parker
/// household through the real application services on the in-memory store,
/// replaces it cleanly on a second run, keeps a paired hub device, derives every
/// date from the injected clock, and always uses the stable household id.
/// #120 AC6: every seeded person's claim colour is a design-token claim colour's
/// dark variant.
/// </summary>
public sealed class DemoSeederTests
{
    // The six claim_colors.*.dark values in Butler.UI/design-tokens.json (berry,
    // marigold, grass, blue, violet, clay). Copied, not read: the API and the UI
    // are independent sub-services, so keep this list in step with that file.
    private static readonly string[] TokenDarkClaimColors =
        ["#EC77B4", "#E3B23C", "#83C24E", "#77A8FF", "#B98CEE", "#E58A69"];

    [Fact]
    public async Task Seed_builds_rooms_people_chores_history_assignments_and_cart_through_the_services()
    {
        using var factory = DemoTestHost.CreateFactory(new MutableClock(DemoTestHost.MidJuly));

        var result = await DemoTestHost.SeedAsync(factory);

        Assert.Equal(6, result.RoomCount);
        Assert.Equal(4, result.ParticipantCount);
        Assert.Equal(15, result.ChoreCount);
        Assert.Equal(48, result.CompletionCount);
        Assert.Equal(15, result.AssignmentCount);
        Assert.Equal(4, result.CartItemCount);

        var household = Assert.Single(await DemoTestHost.RowsAsync<HouseholdEntity>(factory));
        Assert.Equal(DemoHousehold.Name, household.Name);
        Assert.Equal(OrganizerAuthorization.DevOrganizerSubject, household.OrganizerObjectId);

        var rooms = await DemoTestHost.RowsAsync<RoomEntity>(factory);
        Assert.Equal(
            ["Kitchen", "Living Room", "Bathroom", "Bedrooms", "Laundry", "Yard"],
            rooms.OrderBy(room => room.SortOrder).Select(room => room.Name));

        // Four participants (two flagged as children) plus the hidden organizer row
        // that carries the caller's object id for cart confirmation.
        var people = await DemoTestHost.RowsAsync<PersonEntity>(factory);
        Assert.Equal(5, people.Count);
        var organizer = Assert.Single(people, p => p.Role == OrganizerAuthorization.OrganizerRole);
        Assert.Equal(OrganizerAuthorization.DevOrganizerSubject, organizer.OrganizerObjectId);
        var participants = people.Where(p => p.Role == OrganizerAuthorization.ParticipantRole).ToList();
        Assert.Equal(["Ava", "Dan", "Leo", "Maria"], participants.Select(p => p.DisplayName).Order());
        Assert.Equal(["Ava", "Leo"], participants.Where(p => p.IsChild).Select(p => p.DisplayName).Order());
        Assert.All(participants, p => Assert.False(string.IsNullOrWhiteSpace(p.ClaimColor)));
        Assert.All(participants, p => Assert.Contains(p.ClaimColor, TokenDarkClaimColors));
        Assert.Equal(participants.Count, participants.Select(p => p.ClaimColor).Distinct().Count());

        var chores = await DemoTestHost.RowsAsync<ChoreEntity>(factory);
        Assert.Equal(15, chores.Count);
        Assert.All(chores, chore => Assert.True(chore.Active));
        Assert.Contains(chores, chore => chore.Cadence == "Daily");
        Assert.Contains(chores, chore => chore.Cadence == "Weekly");
        Assert.Equal(36, chores.Sum(chore => chore.Effort));
        Assert.All(chores, chore => Assert.Contains(chore.RoomId, rooms.Select(room => room.RowKey)));

        var completions = await DemoTestHost.RowsAsync<ChoreCompletionEntity>(factory);
        Assert.Equal(48, completions.Count);
        Assert.All(completions, c => Assert.Contains(c.PersonId, participants.Select(p => p.RowKey)));

        var assignments = await DemoTestHost.RowsAsync<AssignmentEntity>(factory);
        Assert.Equal(15, assignments.Count);
        Assert.Equal(3, assignments.Count(a => a.Status == AssignmentStatus.Done));
        Assert.All(assignments, a => Assert.NotEqual(organizer.RowKey, a.AssignedPersonId));

        var cart = Assert.Single(await DemoTestHost.RowsAsync<CartEntity>(factory));
        Assert.Equal(result.CurrentWeekIso, cart.RowKey);
        var items = await DemoTestHost.RowsAsync<CartItemEntity>(factory);
        Assert.Equal(
            ["heb-0001", "heb-0005", "heb-0011", "heb-0012"],
            items.Select(item => item.ProductId).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Seed_returns_the_stable_household_id()
    {
        using var factory = DemoTestHost.CreateFactory(new MutableClock(DemoTestHost.MidJuly));

        var result = await DemoTestHost.SeedAsync(factory);

        Assert.Equal("demo-household", result.HouseholdId);
        Assert.Equal(DemoHousehold.Id, result.HouseholdId);
        Assert.Equal(DemoHousehold.Name, result.HouseholdName);
        Assert.Equal(DemoHousehold.Id, Assert.Single(await DemoTestHost.RowsAsync<HouseholdEntity>(factory)).RowKey);
    }

    [Fact]
    public async Task Reseeding_replaces_the_household_without_duplicates()
    {
        var clock = new MutableClock(DemoTestHost.MidJuly);
        using var factory = DemoTestHost.CreateFactory(clock);

        var first = await DemoTestHost.SeedAsync(factory);
        var firstPeople = (await DemoTestHost.RowsAsync<PersonEntity>(factory)).Select(p => p.RowKey).ToList();

        // A later run (an hour on, same week) wipes and rebuilds the household.
        clock.Set(DemoTestHost.MidJuly.AddHours(1));
        var second = await DemoTestHost.SeedAsync(factory);

        Assert.Equal(first.HouseholdId, second.HouseholdId);
        Assert.Single(await DemoTestHost.RowsAsync<HouseholdEntity>(factory));
        var people = await DemoTestHost.RowsAsync<PersonEntity>(factory);
        Assert.Equal(5, people.Count);
        Assert.DoesNotContain(people, p => firstPeople.Contains(p.RowKey));
        Assert.Equal(6, (await DemoTestHost.RowsAsync<RoomEntity>(factory)).Count);
        Assert.Equal(15, (await DemoTestHost.RowsAsync<ChoreEntity>(factory)).Count);
        Assert.Equal(48, (await DemoTestHost.RowsAsync<ChoreCompletionEntity>(factory)).Count);
        Assert.Equal(15, (await DemoTestHost.RowsAsync<AssignmentEntity>(factory)).Count);
        Assert.Single(await DemoTestHost.RowsAsync<CartEntity>(factory));
        Assert.Equal(4, (await DemoTestHost.RowsAsync<CartItemEntity>(factory)).Count);
    }

    [Fact]
    public async Task Reseeding_keeps_a_paired_hub_device()
    {
        using var factory = DemoTestHost.CreateFactory(new MutableClock(DemoTestHost.MidJuly));
        await DemoTestHost.SeedAsync(factory);

        var devices = factory.Services.GetRequiredService<IEntityRepository<HubDeviceEntity>>();
        await devices.AddAsync(DemoHousehold.Id, new HubDeviceEntity
        {
            RowKey = "kitchen-tablet",
            DeviceName = "Kitchen tablet",
            PairedUtc = DemoTestHost.MidJuly,
            LastSeenUtc = DemoTestHost.MidJuly,
        });

        await DemoTestHost.SeedAsync(factory);

        var device = Assert.Single(await devices.ListAsync(DemoHousehold.Id));
        Assert.Equal("kitchen-tablet", device.RowKey);
    }

    [Fact]
    public async Task Fixed_clock_seed_has_current_week_assignments_and_three_prior_weeks_of_completions()
    {
        using var factory = DemoTestHost.CreateFactory(new MutableClock(DemoTestHost.MidJuly));

        var result = await DemoTestHost.SeedAsync(factory);

        Assert.Equal("2026-W29", result.CurrentWeekIso);
        Assert.Equal(["2026-W26", "2026-W27", "2026-W28"], result.HistoryWeekIsos);

        var assignments = await DemoTestHost.RowsAsync<AssignmentEntity>(factory);
        Assert.Equal(15, assignments.Count(a => a.WeekIso == "2026-W29"));
        Assert.All(assignments, a => Assert.Equal("2026-W29", a.WeekIso));

        var completions = await DemoTestHost.RowsAsync<ChoreCompletionEntity>(factory);
        var byWeek = completions.GroupBy(c => c.WeekIso).ToDictionary(g => g.Key, g => g.ToList());
        Assert.Equal(15, byWeek["2026-W26"].Count);
        Assert.Equal(15, byWeek["2026-W27"].Count);
        Assert.Equal(15, byWeek["2026-W28"].Count);
        Assert.Equal(3, byWeek["2026-W29"].Count);
        Assert.Equal(4, byWeek.Count);

        // Back-dated rows sit inside their own week; this week's rows carry "now".
        foreach (var completion in completions)
        {
            Assert.Equal(completion.WeekIso, Butler.Api.Domain.Scheduling.WeekIso.For(completion.CompletedUtc));
            Assert.StartsWith($"{completion.CompletedUtc.UtcTicks}_", completion.RowKey, StringComparison.Ordinal);
        }

        Assert.All(byWeek["2026-W29"], c => Assert.Equal(DemoTestHost.MidJuly, c.CompletedUtc));
    }

    [Fact]
    public async Task Seed_dates_follow_the_clock_across_an_iso_year_boundary()
    {
        using var factory = DemoTestHost.CreateFactory(
            new MutableClock(new DateTimeOffset(2027, 1, 1, 12, 0, 0, TimeSpan.Zero)));

        var result = await DemoTestHost.SeedAsync(factory);

        Assert.Equal("2026-W53", result.CurrentWeekIso);
        Assert.Equal(["2026-W50", "2026-W51", "2026-W52"], result.HistoryWeekIsos);

        var completions = await DemoTestHost.RowsAsync<ChoreCompletionEntity>(factory);
        Assert.Equal(
            ["2026-W50", "2026-W51", "2026-W52", "2026-W53"],
            completions.Select(c => c.WeekIso).Distinct().Order(StringComparer.Ordinal));
        Assert.All(
            await DemoTestHost.RowsAsync<AssignmentEntity>(factory),
            a => Assert.Equal("2026-W53", a.WeekIso));
    }
}
