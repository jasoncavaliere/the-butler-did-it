using Azure;
using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.Events;

/// <summary>
/// The <c>Events</c> table row (#122): one append-only usage event, scoped to the
/// household by <c>PartitionKey = householdId</c>. The <c>RowKey</c> is
/// <c>{OccurredUtc.UtcTicks:D19}_{guid:N}</c>, so a partition lists in time order.
/// </summary>
/// <remarks>
/// Privacy by construction: the row carries only ids that already exist in the
/// household model, the event type, and a timestamp. It never carries a name,
/// an utterance or any other free text.
/// </remarks>
public sealed class EventEntity : ITableEntity
{
    /// <summary>The <c>householdId</c> (Table partition key).</summary>
    public string PartitionKey { get; set; } = string.Empty;

    /// <summary>The time-ordered event id (Table row key).</summary>
    public string RowKey { get; set; } = string.Empty;

    /// <summary>Service-assigned last-write timestamp.</summary>
    public DateTimeOffset? Timestamp { get; set; }

    /// <summary>Optimistic-concurrency version stamp.</summary>
    public ETag ETag { get; set; }

    /// <summary>The event type (an <c>EventTypes</c> constant).</summary>
    public string Type { get; set; } = string.Empty;

    /// <summary>When the server recorded the event (from the injected clock).</summary>
    public DateTimeOffset OccurredUtc { get; set; }

    /// <summary>The person the event is attributed to, when there is one.</summary>
    public string? PersonId { get; set; }

    /// <summary>The chore the event concerns, when there is one.</summary>
    public string? ChoreId { get; set; }

    /// <summary>The ISO year-week the event concerns, when there is one.</summary>
    public string? WeekIso { get; set; }

    /// <summary>The cart item the event concerns, when there is one.</summary>
    public string? ItemId { get; set; }
}
