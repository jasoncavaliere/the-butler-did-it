using Azure;
using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.Households;

/// <summary>
/// The <c>Households</c> table row (Engineering Contract 7.3): the root aggregate
/// every later table hangs off. Both keys are the <c>householdId</c>
/// (<c>PartitionKey = RowKey = householdId</c>), so a household is a single-row
/// partition addressed by its own id.
/// </summary>
public sealed class HouseholdEntity : ITableEntity
{
    /// <summary>The <c>householdId</c> (Table partition key).</summary>
    public string PartitionKey { get; set; } = string.Empty;

    /// <summary>The <c>householdId</c> (Table row key - same value as the partition key).</summary>
    public string RowKey { get; set; } = string.Empty;

    /// <summary>Service-assigned last-write timestamp.</summary>
    public DateTimeOffset? Timestamp { get; set; }

    /// <summary>Optimistic-concurrency version stamp.</summary>
    public ETag ETag { get; set; }

    /// <summary>The household's display name.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Object id of the organizer who created (and owns) the household.</summary>
    public string OrganizerObjectId { get; set; } = string.Empty;

    /// <summary>When the household was created, from the injected clock.</summary>
    public DateTimeOffset CreatedUtc { get; set; }
}
