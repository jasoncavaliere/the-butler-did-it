using Butler.Api.Application.Concurrency;
using Butler.Api.Infrastructure.Assignments;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Domain.Scheduling;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Criterion: <see cref="TableAssignmentRepository"/> round-trips an assignment
/// scoped by <c>householdId</c> on the F3 in-memory store, isolates households, and
/// mutates status under optimistic concurrency (the seam C4 flips Open -> Done on).
/// </summary>
public sealed class AssignmentRepositoryTests
{
    private static TableAssignmentRepository NewRepository() =>
        new(new InMemoryEntityRepository<AssignmentEntity>());

    private static AssignmentEntity Assignment(string weekIso, string choreId, string personId) => new()
    {
        RowKey = $"{weekIso}_{choreId}",
        AssignedPersonId = personId,
        WeekIso = weekIso,
        DueDateUtc = new DateTimeOffset(2026, 7, 19, 23, 59, 0, TimeSpan.Zero),
        Status = AssignmentStatus.Open,
    };

    [Fact]
    public async Task Add_then_get_round_trips_a_household_scoped_assignment()
    {
        var repository = NewRepository();
        var weekIso = WeekIso.For(new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero));

        await repository.AddAsync("house-1", Assignment(weekIso, "chore-1", "person-1"), CancellationToken.None);

        var stored = await repository.GetAsync("house-1", $"{weekIso}_chore-1", CancellationToken.None);
        Assert.NotNull(stored);
        Assert.Equal("house-1", stored!.PartitionKey);
        Assert.Equal($"{weekIso}_chore-1", stored.RowKey);
        Assert.Equal("person-1", stored.AssignedPersonId);
        Assert.Equal(weekIso, stored.WeekIso);
        Assert.Equal(new DateTimeOffset(2026, 7, 19, 23, 59, 0, TimeSpan.Zero), stored.DueDateUtc);
        Assert.Equal(AssignmentStatus.Open, stored.Status);
    }

    [Fact]
    public async Task Get_does_not_cross_household_boundaries()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", Assignment("2026-W29", "chore-1", "person-1"), CancellationToken.None);

        // Same row key in a different household is a separate, absent row.
        Assert.Null(await repository.GetAsync("house-2", "2026-W29_chore-1", CancellationToken.None));
    }

    [Fact]
    public async Task List_returns_only_the_households_assignments()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", Assignment("2026-W29", "chore-1", "person-1"), CancellationToken.None);
        await repository.AddAsync("house-1", Assignment("2026-W29", "chore-2", "person-2"), CancellationToken.None);
        await repository.AddAsync("house-2", Assignment("2026-W29", "chore-1", "person-9"), CancellationToken.None);

        var listed = await repository.ListAsync("house-1", CancellationToken.None);

        Assert.Equal(2, listed.Count);
        Assert.All(listed, a => Assert.Equal("house-1", a.PartitionKey));
    }

    [Fact]
    public async Task Update_flips_status_to_done_under_matching_concurrency()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", Assignment("2026-W29", "chore-1", "person-1"), CancellationToken.None);

        var current = await repository.GetAsync("house-1", "2026-W29_chore-1", CancellationToken.None);
        current!.Status = AssignmentStatus.Done;
        await repository.UpdateAsync("house-1", current, current.ETag.ToString(), CancellationToken.None);

        var updated = await repository.GetAsync("house-1", "2026-W29_chore-1", CancellationToken.None);
        Assert.Equal(AssignmentStatus.Done, updated!.Status);
    }

    [Fact]
    public async Task Update_without_if_match_is_rejected()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", Assignment("2026-W29", "chore-1", "person-1"), CancellationToken.None);
        var current = await repository.GetAsync("house-1", "2026-W29_chore-1", CancellationToken.None);

        await Assert.ThrowsAsync<PreconditionRequiredException>(
            () => repository.UpdateAsync("house-1", current!, null, CancellationToken.None));
    }

    [Fact]
    public async Task Update_with_a_stale_if_match_is_rejected()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", Assignment("2026-W29", "chore-1", "person-1"), CancellationToken.None);
        var current = await repository.GetAsync("house-1", "2026-W29_chore-1", CancellationToken.None);

        await Assert.ThrowsAsync<PreconditionFailedException>(
            () => repository.UpdateAsync("house-1", current!, "\"stale-etag\"", CancellationToken.None));
    }

    [Fact]
    public void Constructor_rejects_a_null_inner_repository()
    {
        Assert.Throws<ArgumentNullException>(() => new TableAssignmentRepository(null!));
    }

    [Fact]
    public async Task AddAsync_rejects_a_null_assignment_or_blank_key()
    {
        var repository = NewRepository();

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => repository.AddAsync("house-1", null!, CancellationToken.None));

        var blankKey = Assignment("2026-W29", "chore-1", "p");
        blankKey.RowKey = string.Empty;
        await Assert.ThrowsAsync<ArgumentException>(
            () => repository.AddAsync("house-1", blankKey, CancellationToken.None));
    }

    [Fact]
    public async Task UpdateAsync_rejects_a_null_assignment_or_blank_key()
    {
        var repository = NewRepository();

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => repository.UpdateAsync("house-1", null!, "\"etag\"", CancellationToken.None));

        var blank = Assignment("2026-W29", "chore-1", "p");
        blank.RowKey = string.Empty;
        await Assert.ThrowsAsync<ArgumentException>(
            () => repository.UpdateAsync("house-1", blank, "\"etag\"", CancellationToken.None));
    }

    [Theory]
    [InlineData(null, "2026-W29_chore-1")]
    [InlineData("", "2026-W29_chore-1")]
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
