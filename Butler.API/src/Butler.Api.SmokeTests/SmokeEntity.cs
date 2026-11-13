using Azure;
using Azure.Data.Tables;

namespace Butler.Api.SmokeTests;

/// <summary>
/// A minimal <see cref="ITableEntity"/> the storage smoke tests round-trip
/// through the production <c>IEntityRepository&lt;T&gt;</c> seam. It lives only
/// in a throwaway per-run table, so it never touches a real feature table.
/// </summary>
public sealed class SmokeEntity : ITableEntity
{
    public string PartitionKey { get; set; } = string.Empty;

    public string RowKey { get; set; } = string.Empty;

    public DateTimeOffset? Timestamp { get; set; }

    public ETag ETag { get; set; }

    /// <summary>Arbitrary payload so a stored value can be asserted after a read.</summary>
    public string Payload { get; set; } = string.Empty;
}
