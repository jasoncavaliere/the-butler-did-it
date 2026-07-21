using Azure;
using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.ChoreCompletions;

/// <summary>
/// The <c>ChoreCompletions</c> table row (Engineering Contract 7.3): an
/// append-only ledger entry recording that a person completed a chore, scoped to
/// the household by <c>PartitionKey = householdId</c> with
/// <c>RowKey = {completedUtcTicks}_{choreId}</c> so entries sort chronologically
/// within the partition. Completions are never mutated or deleted (BRD R-2); the
/// fairness math reads them by <see cref="WeekIso"/> and <see cref="Effort"/>.
/// </summary>
public sealed class ChoreCompletionEntity : ITableEntity
{
    /// <summary>The <c>householdId</c> (Table partition key).</summary>
    public string PartitionKey { get; set; } = string.Empty;

    /// <summary>The <c>{completedUtcTicks}_{choreId}</c> composite (Table row key).</summary>
    public string RowKey { get; set; } = string.Empty;

    /// <summary>Service-assigned last-write timestamp.</summary>
    public DateTimeOffset? Timestamp { get; set; }

    /// <summary>Optimistic-concurrency version stamp.</summary>
    public ETag ETag { get; set; }

    /// <summary>The <c>choreId</c> that was completed.</summary>
    public string ChoreId { get; set; } = string.Empty;

    /// <summary>The <c>personId</c> who completed the chore.</summary>
    public string PersonId { get; set; } = string.Empty;

    /// <summary>When the chore was completed, in UTC.</summary>
    public DateTimeOffset CompletedUtc { get; set; }

    /// <summary>The effort weight credited for this completion (mirrors the chore's effort).</summary>
    public int Effort { get; set; }

    /// <summary>The ISO-8601 year-week the completion is bucketed into (for example <c>2026-W29</c>).</summary>
    public string WeekIso { get; set; } = string.Empty;
}
