using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Domain.Scheduling;

namespace Butler.Api.Tests.ChoreCompletions;

/// <summary>
/// Criterion: <see cref="TableChoreCompletionRepository"/> appends and reads
/// completions scoped by <c>householdId</c> on the F3 in-memory store, isolating
/// households. The ledger is append-only (BRD R-2) - the seam exposes no mutation.
/// </summary>
public sealed class ChoreCompletionRepositoryTests
{
    private static TableChoreCompletionRepository NewRepository() =>
        new(new InMemoryEntityRepository<ChoreCompletionEntity>());

    private static ChoreCompletionEntity Completion(DateTimeOffset completedUtc, string choreId, string personId) => new()
    {
        RowKey = $"{completedUtc.UtcTicks}_{choreId}",
        ChoreId = choreId,
        PersonId = personId,
        CompletedUtc = completedUtc,
        Effort = 3,
        WeekIso = WeekIso.For(completedUtc),
    };

    [Fact]
    public async Task Add_then_get_round_trips_a_household_scoped_completion()
    {
        var repository = NewRepository();
        var completedUtc = new DateTimeOffset(2026, 7, 14, 8, 30, 0, TimeSpan.Zero);
        var rowKey = $"{completedUtc.UtcTicks}_chore-1";

        await repository.AddAsync("house-1", Completion(completedUtc, "chore-1", "person-1"), CancellationToken.None);

        var stored = await repository.GetAsync("house-1", rowKey, CancellationToken.None);
        Assert.NotNull(stored);
        Assert.Equal("house-1", stored!.PartitionKey);
        Assert.Equal(rowKey, stored.RowKey);
        Assert.Equal("chore-1", stored.ChoreId);
        Assert.Equal("person-1", stored.PersonId);
        Assert.Equal(completedUtc, stored.CompletedUtc);
        Assert.Equal(3, stored.Effort);
        Assert.Equal("2026-W29", stored.WeekIso);
    }

    [Fact]
    public async Task Get_does_not_cross_household_boundaries()
    {
        var repository = NewRepository();
        var completedUtc = new DateTimeOffset(2026, 7, 14, 8, 30, 0, TimeSpan.Zero);
        await repository.AddAsync("house-1", Completion(completedUtc, "chore-1", "person-1"), CancellationToken.None);

        Assert.Null(await repository.GetAsync("house-2", $"{completedUtc.UtcTicks}_chore-1", CancellationToken.None));
    }

    [Fact]
    public async Task List_returns_only_the_households_completions()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", Completion(new DateTimeOffset(2026, 7, 14, 8, 0, 0, TimeSpan.Zero), "chore-1", "person-1"), CancellationToken.None);
        await repository.AddAsync("house-1", Completion(new DateTimeOffset(2026, 7, 15, 9, 0, 0, TimeSpan.Zero), "chore-2", "person-2"), CancellationToken.None);
        await repository.AddAsync("house-2", Completion(new DateTimeOffset(2026, 7, 14, 8, 0, 0, TimeSpan.Zero), "chore-1", "person-9"), CancellationToken.None);

        var listed = await repository.ListAsync("house-1", CancellationToken.None);

        Assert.Equal(2, listed.Count);
        Assert.All(listed, c => Assert.Equal("house-1", c.PartitionKey));
    }

    [Fact]
    public void Constructor_rejects_a_null_inner_repository()
    {
        Assert.Throws<ArgumentNullException>(() => new TableChoreCompletionRepository(null!));
    }

    [Fact]
    public async Task AddAsync_rejects_a_null_completion_or_blank_key()
    {
        var repository = NewRepository();

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => repository.AddAsync("house-1", null!, CancellationToken.None));

        var blankKey = Completion(new DateTimeOffset(2026, 7, 14, 8, 0, 0, TimeSpan.Zero), "chore-1", "p");
        blankKey.RowKey = string.Empty;
        await Assert.ThrowsAsync<ArgumentException>(
            () => repository.AddAsync("house-1", blankKey, CancellationToken.None));
    }

    [Theory]
    [InlineData(null, "1_chore-1")]
    [InlineData("", "1_chore-1")]
    [InlineData("house-1", null)]
    [InlineData("house-1", "")]
    public async Task GetAsync_rejects_blank_scope(string? householdId, string? rowKey)
    {
        var repository = NewRepository();

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => repository.GetAsync(householdId!, rowKey!, CancellationToken.None));
    }

    [Fact]
    public async Task ListAsync_rejects_a_blank_household()
    {
        var repository = NewRepository();

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => repository.ListAsync(string.Empty, CancellationToken.None));
    }
}
