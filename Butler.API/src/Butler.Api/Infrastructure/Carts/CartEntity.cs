using Azure;
using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.Carts;

/// <summary>
/// The <c>Carts</c> table row (Engineering Contract 7.3): one grocery cart per
/// household per ISO week, scoped to the household by
/// <c>PartitionKey = householdId</c> with <c>RowKey = {weekIso}</c> so a week has
/// exactly one cart row and a week's cart is addressable without a scan. The
/// capture flow (G3) writes <c>CartItems</c> into it; the confirm flow (G4) flips
/// <see cref="Status"/> from <see cref="CartStatus.Building"/> to
/// <see cref="CartStatus.Confirmed"/> under optimistic concurrency, stamping
/// <see cref="ConfirmedByPersonId"/> and <see cref="ConfirmedUtc"/>.
/// </summary>
public sealed class CartEntity : ITableEntity
{
    /// <summary>The <c>householdId</c> (Table partition key).</summary>
    public string PartitionKey { get; set; } = string.Empty;

    /// <summary>The ISO-8601 year-week the cart belongs to (Table row key, for example <c>2026-W29</c>).</summary>
    public string RowKey { get; set; } = string.Empty;

    /// <summary>Service-assigned last-write timestamp.</summary>
    public DateTimeOffset? Timestamp { get; set; }

    /// <summary>Optimistic-concurrency version stamp.</summary>
    public ETag ETag { get; set; }

    /// <summary>Lifecycle state: <see cref="CartStatus.Building"/> or <see cref="CartStatus.Confirmed"/>.</summary>
    public string Status { get; set; } = CartStatus.Building;

    /// <summary>The organizer's <c>personId</c> who confirmed the cart; <c>null</c> while building.</summary>
    public string? ConfirmedByPersonId { get; set; }

    /// <summary>When the cart was confirmed, in UTC; <c>null</c> while building.</summary>
    public DateTimeOffset? ConfirmedUtc { get; set; }
}
