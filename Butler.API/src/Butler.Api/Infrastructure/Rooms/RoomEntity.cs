using Azure;
using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.Rooms;

/// <summary>
/// The <c>Rooms</c> table row (Engineering Contract 7.3): a physical room in a
/// household, scoped to the household by <c>PartitionKey = householdId</c> with a
/// per-room <c>RowKey = roomId</c>. Rooms are the physical map chores attach to
/// (H4), so <see cref="SortOrder"/> fixes their order on the hub board.
/// </summary>
public sealed class RoomEntity : ITableEntity
{
    /// <summary>The <c>householdId</c> (Table partition key).</summary>
    public string PartitionKey { get; set; } = string.Empty;

    /// <summary>The <c>roomId</c> (Table row key).</summary>
    public string RowKey { get; set; } = string.Empty;

    /// <summary>Service-assigned last-write timestamp.</summary>
    public DateTimeOffset? Timestamp { get; set; }

    /// <summary>Optimistic-concurrency version stamp.</summary>
    public ETag ETag { get; set; }

    /// <summary>The room's display name shown on the hub board.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>The room's position in the ascending hub-board ordering.</summary>
    public int SortOrder { get; set; }
}
