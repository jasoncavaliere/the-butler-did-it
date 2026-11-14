using Azure;
using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.System;

/// <summary>
/// The single <c>Datasets</c> table row (#100 D7): the id of the dataset the
/// deployment is currently serving. The hub compares it with the id it last saw
/// to tell when its offline cache and write queue belong to data that no longer
/// exists (a demo reseed or wiped storage).
/// </summary>
/// <remarks>
/// This is a documented exception to Engineering Contract 7.3
/// (<c>PartitionKey = householdId</c>): the dataset id covers the whole
/// deployment, not one household, so the row lives at the fixed reserved
/// partition <see cref="Partition"/> and row <see cref="Row"/>. No household id
/// can collide with it, because household ids are server-generated GUIDs or the
/// fixed demo id.
/// </remarks>
public sealed class DatasetEntity : ITableEntity
{
    /// <summary>The table that holds the dataset row.</summary>
    public const string TableName = "Datasets";

    /// <summary>The reserved deployment-wide partition key.</summary>
    public const string Partition = "_system";

    /// <summary>The row key of the single dataset row.</summary>
    public const string Row = "dataset";

    /// <summary>Always <see cref="Partition"/> (Table partition key).</summary>
    public string PartitionKey { get; set; } = string.Empty;

    /// <summary>Always <see cref="Row"/> (Table row key).</summary>
    public string RowKey { get; set; } = string.Empty;

    /// <summary>Service-assigned last-write timestamp.</summary>
    public DateTimeOffset? Timestamp { get; set; }

    /// <summary>Optimistic-concurrency version stamp.</summary>
    public ETag ETag { get; set; }

    /// <summary>The opaque dataset id (a GUID in <c>"N"</c> format).</summary>
    public string DatasetId { get; set; } = string.Empty;

    /// <summary>When this dataset id was minted, from the injected clock.</summary>
    public DateTimeOffset CreatedUtc { get; set; }
}
