using Butler.Api.Application.Demo;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Demo;

/// <summary>
/// Criterion (#97 AC7): aggregated by week, the seeded completion history shows
/// the top contributor's share falling week over week - the demo's "the family
/// is getting fairer" story - and the script that produces it is well formed.
/// </summary>
public sealed class DemoHistoryFairnessTests
{
    [Fact]
    public async Task Top_contributor_share_falls_week_over_week()
    {
        using var factory = DemoTestHost.CreateFactory(new MutableClock(DemoTestHost.MidJuly));
        var result = await DemoTestHost.SeedAsync(factory);
        var completions = await DemoTestHost.RowsAsync<ChoreCompletionEntity>(factory);

        var topShares = result.HistoryWeekIsos
            .Select(week => TopShare(completions.Where(c => c.WeekIso == week).Select(c => (c.PersonId, c.Effort))))
            .ToList();

        Assert.Equal(3, topShares.Count);
        Assert.True(topShares[0] > topShares[1], $"{topShares[0]} should exceed {topShares[1]}");
        Assert.True(topShares[1] > topShares[2], $"{topShares[1]} should exceed {topShares[2]}");
        Assert.Equal([66.7, 52.8, 38.9], topShares.Select(share => Math.Round(share * 100, 1)));
    }

    [Fact]
    public void History_script_is_balanced_by_construction()
    {
        var chores = DemoHousehold.Chores.ToDictionary(chore => chore.Number);
        var people = DemoHousehold.People.ToDictionary(person => person.Key);

        Assert.Equal(15, chores.Count);
        Assert.Equal(36, chores.Values.Sum(chore => chore.Effort));
        Assert.All(DemoHousehold.Chores, chore => Assert.Contains(chore.RoomName, DemoHousehold.Rooms.Select(r => r.Name)));
        Assert.Equal([3, 2, 1], DemoHousehold.History.Select(week => week.WeeksAgo));

        var previousTop = double.MaxValue;
        foreach (var week in DemoHousehold.History)
        {
            // Every chore is done exactly once a week.
            Assert.Equal(
                Enumerable.Range(1, 15),
                week.Completions.Select(c => c.ChoreNumber).Order());

            // Children never get a chore with a minimum age.
            Assert.All(
                week.Completions.Where(c => people[c.PersonKey].IsChild),
                c => Assert.Null(chores[c.ChoreNumber].MinAge));

            var share = TopShare(week.Completions.Select(c => (c.PersonKey, chores[c.ChoreNumber].Effort)));
            var top = week.Completions
                .GroupBy(c => c.PersonKey)
                .OrderByDescending(g => g.Sum(c => chores[c.ChoreNumber].Effort))
                .First()
                .Key;
            Assert.Equal("maria", top);
            Assert.True(share < previousTop);
            previousTop = share;
        }

        Assert.All(DemoHousehold.CurrentWeekCompletedChores, number => Assert.Null(chores[number].MinAge));
        Assert.All(DemoHousehold.CartItems, item => Assert.Contains(item.AddedByKey, people.Keys));
    }

    private static double TopShare(IEnumerable<(string Person, int Effort)> completions)
    {
        var byPerson = completions
            .GroupBy(c => c.Person)
            .Select(g => g.Sum(c => c.Effort))
            .ToList();
        return (double)byPerson.Max() / byPerson.Sum();
    }
}
