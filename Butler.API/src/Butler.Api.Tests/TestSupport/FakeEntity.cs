using Azure;
using Azure.Data.Tables;

namespace Butler.Api.Tests.TestSupport;

/// <summary>
/// A minimal <see cref="ITableEntity"/> used to exercise the generic F3 storage
/// seam (<c>IEntityRepository&lt;T&gt;</c> and its Table/in-memory implementations)
/// without depending on a concrete feature entity, which arrive in later tickets
/// (H1+). Carries one payload field so round-trip writes are observable.
/// </summary>
public sealed class FakeEntity : ITableEntity
{
    public string PartitionKey { get; set; } = string.Empty;

    public string RowKey { get; set; } = string.Empty;

    public DateTimeOffset? Timestamp { get; set; }

    public ETag ETag { get; set; }

    /// <summary>Arbitrary payload so a stored value can be asserted after a read.</summary>
    public string Payload { get; set; } = string.Empty;
}
