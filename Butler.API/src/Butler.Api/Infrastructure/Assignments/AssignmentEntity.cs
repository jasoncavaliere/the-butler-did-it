using Azure;
using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.Assignments;

/// <summary>
/// The <c>Assignments</c> table row (Engineering Contract 7.3): one chore assigned
/// to one person for one ISO week, scoped to the household by
/// <c>PartitionKey = householdId</c> with <c>RowKey = {weekIso}_{choreId}</c> so a
/// week's assignments read back as a contiguous key range. The fair-assignment
/// engine (C2) writes these; the completion flow (C4) flips <see cref="Status"/>
/// from <see cref="AssignmentStatus.Open"/> to <see cref="AssignmentStatus.Done"/>
/// under optimistic concurrency.
/// </summary>
public sealed class AssignmentEntity : ITableEntity
{
    /// <summary>The <c>householdId</c> (Table partition key).</summary>
    public string PartitionKey { get; set; } = string.Empty;

    /// <summary>The <c>{weekIso}_{choreId}</c> composite (Table row key).</summary>
    public string RowKey { get; set; } = string.Empty;

    /// <summary>Service-assigned last-write timestamp.</summary>
    public DateTimeOffset? Timestamp { get; set; }

    /// <summary>Optimistic-concurrency version stamp.</summary>
    public ETag ETag { get; set; }

    /// <summary>The <c>personId</c> this chore is assigned to for the week.</summary>
    public string AssignedPersonId { get; set; } = string.Empty;

    /// <summary>The ISO-8601 year-week this assignment belongs to (for example <c>2026-W29</c>).</summary>
    public string WeekIso { get; set; } = string.Empty;

    /// <summary>When the assignment is due, in UTC.</summary>
    public DateTimeOffset DueDateUtc { get; set; }

    /// <summary>Lifecycle state: <see cref="AssignmentStatus.Open"/> or <see cref="AssignmentStatus.Done"/>.</summary>
    public string Status { get; set; } = AssignmentStatus.Open;
}
