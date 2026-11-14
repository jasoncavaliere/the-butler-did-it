using System.Globalization;
using Butler.Api.Infrastructure.Events;
using Microsoft.Extensions.Logging;

namespace Butler.Api.Application.Events;

/// <summary>
/// <see cref="IEventRecorder"/> over <see cref="IEventRepository"/>. The row key is
/// <c>{OccurredUtc.UtcTicks:D19}_{guid:N}</c>, so a household's events list in
/// time order and two events in the same tick never collide.
/// </summary>
public sealed partial class EventRecorder : IEventRecorder
{
    private readonly IEventRepository _events;
    private readonly TimeProvider _clock;
    private readonly ILogger<EventRecorder> _logger;

    public EventRecorder(IEventRepository events, TimeProvider clock, ILogger<EventRecorder> logger)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(logger);
        _events = events;
        _clock = clock;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task RecordAsync(
        string householdId,
        string type,
        string? personId = null,
        string? choreId = null,
        string? weekIso = null,
        string? itemId = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        if (!EventTypes.IsKnown(type))
        {
            throw new ArgumentException($"Unknown event type '{type}'.", nameof(type));
        }

        var occurredUtc = _clock.GetUtcNow();
        var entity = new EventEntity
        {
            RowKey = string.Create(
                CultureInfo.InvariantCulture,
                $"{occurredUtc.UtcTicks:D19}_{Guid.NewGuid():N}"),
            Type = type,
            OccurredUtc = occurredUtc,
            PersonId = personId,
            ChoreId = choreId,
            WeekIso = weekIso,
            ItemId = itemId,
        };
        return _events.AddAsync(householdId, entity, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<bool> TryRecordAsync(
        string householdId,
        string type,
        string? personId = null,
        string? choreId = null,
        string? weekIso = null,
        string? itemId = null,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await RecordAsync(householdId, type, personId, choreId, weekIso, itemId, cancellationToken)
                .ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogRecordFailed(ex, type, householdId);
            return false;
        }
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Could not record usage event {Type} for household {HouseholdId}")]
    private partial void LogRecordFailed(Exception exception, string type, string householdId);
}
