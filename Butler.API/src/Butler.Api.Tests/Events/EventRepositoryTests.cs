using Butler.Api.Infrastructure.Events;
using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Tests.Events;

/// <summary>
/// Criterion (#122 AC1): the <c>Events</c> row is appended to the household's
/// partition through the append-only <see cref="IEventRepository"/>, and no
/// listing crosses a household boundary.
/// </summary>
public sealed class EventRepositoryTests
{
    private static readonly DateTimeOffset At = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);

    private static TableEventRepository NewRepository() =>
        new(new InMemoryEntityRepository<EventEntity>());

    private static EventEntity Event(string rowKey) => new()
    {
        RowKey = rowKey,
        Type = "chore-completed",
        OccurredUtc = At,
        PersonId = "person-1",
        ChoreId = "chore-1",
        WeekIso = "2026-W29",
        ItemId = "item-1",
    };

    [Fact]
    public async Task Add_then_list_round_trips_every_field()
    {
        var repository = NewRepository();

        await repository.AddAsync("house-1", Event("0001_a"), CancellationToken.None);

        var stored = Assert.Single(await repository.ListAsync("house-1", CancellationToken.None));
        Assert.Equal("house-1", stored.PartitionKey);
        Assert.Equal("0001_a", stored.RowKey);
        Assert.Equal("chore-completed", stored.Type);
        Assert.Equal(At, stored.OccurredUtc);
        Assert.Equal("person-1", stored.PersonId);
        Assert.Equal("chore-1", stored.ChoreId);
        Assert.Equal("2026-W29", stored.WeekIso);
        Assert.Equal("item-1", stored.ItemId);
    }

    [Fact]
    public async Task Listing_does_not_cross_household_boundaries()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", Event("0001_a"), CancellationToken.None);
        await repository.AddAsync("house-2", Event("0002_b"), CancellationToken.None);

        var listed = await repository.ListAsync("house-1", CancellationToken.None);

        Assert.Equal("0001_a", Assert.Single(listed).RowKey);
    }

    [Fact]
    public async Task A_household_with_no_events_lists_empty()
    {
        Assert.Empty(await NewRepository().ListAsync("house-1", CancellationToken.None));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public async Task Add_rejects_a_missing_household(string? householdId)
    {
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => NewRepository().AddAsync(householdId!, Event("0001_a"), CancellationToken.None));
    }

    [Fact]
    public async Task Add_rejects_a_null_entity()
    {
        await Assert.ThrowsAsync<ArgumentNullException>(
            () => NewRepository().AddAsync("house-1", null!, CancellationToken.None));
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    public async Task Add_rejects_a_missing_row_key(string rowKey)
    {
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => NewRepository().AddAsync("house-1", Event(rowKey), CancellationToken.None));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public async Task List_rejects_a_missing_household(string? householdId)
    {
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => NewRepository().ListAsync(householdId!, CancellationToken.None));
    }

    [Fact]
    public void The_repository_requires_its_table_seam()
    {
        Assert.Throws<ArgumentNullException>(() => new TableEventRepository(null!));
    }
}
