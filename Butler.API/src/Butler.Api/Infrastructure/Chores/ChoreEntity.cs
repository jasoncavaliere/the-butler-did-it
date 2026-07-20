using Azure;
using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.Chores;

/// <summary>
/// The <c>Chores</c> table row (Engineering Contract 7.3): a recurring task in a
/// household, scoped to the household by <c>PartitionKey = householdId</c> with a
/// per-chore <c>RowKey = choreId</c>. A chore attaches to a <c>Room</c> (H2) in
/// the same household and carries the <see cref="Effort"/>, <see cref="Cadence"/>,
/// and <see cref="MinAge"/> the Epic 40 fair-assignment engine reads.
/// Deactivation (<see cref="Active"/> = <c>false</c>) is preferred over deletion
/// so historical assignments and completions keep referential meaning.
/// </summary>
public sealed class ChoreEntity : ITableEntity
{
    /// <summary>The <c>householdId</c> (Table partition key).</summary>
    public string PartitionKey { get; set; } = string.Empty;

    /// <summary>The <c>choreId</c> (Table row key).</summary>
    public string RowKey { get; set; } = string.Empty;

    /// <summary>Service-assigned last-write timestamp.</summary>
    public DateTimeOffset? Timestamp { get; set; }

    /// <summary>Optimistic-concurrency version stamp.</summary>
    public ETag ETag { get; set; }

    /// <summary>The chore's display title shown on the hub board.</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>The <c>roomId</c> of the room this chore attaches to (same household).</summary>
    public string RoomId { get; set; } = string.Empty;

    /// <summary>How often the chore recurs: <c>Daily</c> or <c>Weekly</c>.</summary>
    public string Cadence { get; set; } = string.Empty;

    /// <summary>Relative effort weight the assignment engine balances on (positive).</summary>
    public int Effort { get; set; }

    /// <summary>Minimum age required to be assigned this chore; <c>null</c> when unrestricted.</summary>
    public int? MinAge { get; set; }

    /// <summary>Whether the chore is active; deactivated chores are retained, not deleted.</summary>
    public bool Active { get; set; } = true;
}
