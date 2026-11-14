using System.Globalization;
using Butler.Api.Application.Events;
using Butler.Api.Infrastructure.Events;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;
using Microsoft.Extensions.Logging;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace Butler.Api.Tests.Events;

/// <summary>
/// Criterion (#122 AC1): the recorder appends a row to the household partition,
/// stamped by the injected clock, with a time-ordered row key. The best-effort
/// variant swallows and logs a storage failure but never swallows cancellation.
/// </summary>
public sealed class EventRecorderTests
{
    private static readonly DateTimeOffset At = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);

    private readonly InMemoryEntityRepository<EventEntity> _store = new();
    private readonly CapturingLogger<EventRecorder> _logger = new();

    private EventRecorder NewRecorder(IEventRepository? repository = null) =>
        new(repository ?? new TableEventRepository(_store), new MutableClock(At), _logger);

    [Fact]
    public async Task Record_appends_a_row_in_the_household_partition_stamped_by_the_injected_clock()
    {
        await NewRecorder().RecordAsync(
            "house-1",
            EventTypes.ChoreCompleted,
            personId: "person-1",
            choreId: "chore-1",
            weekIso: "2026-W29",
            itemId: "item-1",
            cancellationToken: CancellationToken.None);

        var stored = Assert.Single(await _store.ListAsync("house-1", CancellationToken.None));
        Assert.Equal("house-1", stored.PartitionKey);
        Assert.Equal(EventTypes.ChoreCompleted, stored.Type);
        Assert.Equal(At, stored.OccurredUtc);
        Assert.Equal("person-1", stored.PersonId);
        Assert.Equal("chore-1", stored.ChoreId);
        Assert.Equal("2026-W29", stored.WeekIso);
        Assert.Equal("item-1", stored.ItemId);

        var parts = stored.RowKey.Split('_');
        Assert.Equal(2, parts.Length);
        Assert.Equal(At.UtcTicks.ToString("D19", CultureInfo.InvariantCulture), parts[0]);
        Assert.Equal(32, parts[1].Length);
    }

    [Fact]
    public async Task Two_events_in_the_same_tick_do_not_collide()
    {
        var recorder = NewRecorder();

        await recorder.RecordAsync("house-1", EventTypes.HubGlanced);
        await recorder.RecordAsync("house-1", EventTypes.HubGlanced);

        Assert.Equal(2, (await _store.ListAsync("house-1", CancellationToken.None)).Count);
    }

    [Theory]
    [InlineData("nonsense")]
    [InlineData("HUB-GLANCED")]
    [InlineData("")]
    public async Task Record_rejects_an_unknown_type(string type)
    {
        await Assert.ThrowsAsync<ArgumentException>(() => NewRecorder().RecordAsync("house-1", type));
        Assert.Empty(await _store.ListAsync("house-1", CancellationToken.None));
    }

    [Fact]
    public async Task Record_rejects_a_missing_household()
    {
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => NewRecorder().RecordAsync(" ", EventTypes.HubGlanced));
    }

    [Fact]
    public async Task Record_lets_a_storage_failure_propagate()
    {
        var repository = Substitute.For<IEventRepository>();
        repository
            .AddAsync(Arg.Any<string>(), Arg.Any<EventEntity>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new InvalidOperationException("storage down"));

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => NewRecorder(repository).RecordAsync("house-1", EventTypes.HubGlanced));
    }

    [Fact]
    public async Task TryRecord_returns_true_when_the_row_is_written()
    {
        Assert.True(await NewRecorder().TryRecordAsync("house-1", EventTypes.CartConfirmed, personId: "p"));
        Assert.Single(await _store.ListAsync("house-1", CancellationToken.None));
        Assert.Empty(_logger.Entries);
    }

    [Fact]
    public async Task TryRecord_swallows_and_logs_a_storage_failure()
    {
        var repository = Substitute.For<IEventRepository>();
        var failure = new InvalidOperationException("storage down");
        repository
            .AddAsync(Arg.Any<string>(), Arg.Any<EventEntity>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(failure);

        var recorded = await NewRecorder(repository).TryRecordAsync("house-1", EventTypes.ChoreUndone);

        Assert.False(recorded);
        var entry = Assert.Single(_logger.Entries);
        Assert.Equal(LogLevel.Warning, entry.Level);
        Assert.Same(failure, entry.Exception);
        Assert.Contains(EventTypes.ChoreUndone, entry.Message, StringComparison.Ordinal);
        Assert.Contains("house-1", entry.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TryRecord_rethrows_cancellation()
    {
        var repository = Substitute.For<IEventRepository>();
        repository
            .AddAsync(Arg.Any<string>(), Arg.Any<EventEntity>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new OperationCanceledException());

        await Assert.ThrowsAsync<OperationCanceledException>(
            () => NewRecorder(repository).TryRecordAsync("house-1", EventTypes.HubGlanced));
        Assert.Empty(_logger.Entries);
    }

    [Fact]
    public void The_recorder_requires_every_collaborator()
    {
        var repository = Substitute.For<IEventRepository>();
        var clock = new MutableClock(At);

        Assert.Throws<ArgumentNullException>(() => new EventRecorder(null!, clock, _logger));
        Assert.Throws<ArgumentNullException>(() => new EventRecorder(repository, null!, _logger));
        Assert.Throws<ArgumentNullException>(() => new EventRecorder(repository, clock, null!));
    }

    [Theory]
    [InlineData(EventTypes.ChoreCompleted, true, false)]
    [InlineData(EventTypes.ChoreUndone, true, false)]
    [InlineData(EventTypes.CartItemAdded, true, false)]
    [InlineData(EventTypes.CartConfirmed, true, false)]
    [InlineData(EventTypes.ParticipantClaimed, true, false)]
    [InlineData(EventTypes.HubGlanced, true, true)]
    [InlineData("Hub-Glanced", false, false)]
    [InlineData("", false, false)]
    [InlineData(null, false, false)]
    public void The_type_allowlists_are_ordinal(string? type, bool known, bool clientAllowed)
    {
        Assert.Equal(known, EventTypes.IsKnown(type));
        Assert.Equal(clientAllowed, EventTypes.IsClientAllowed(type));
    }
}
