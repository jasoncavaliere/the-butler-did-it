using Azure;
using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.Carts;

/// <summary>
/// The <c>CartItems</c> table row (Engineering Contract 7.3): one line item in one
/// week's cart, scoped to the household by <c>PartitionKey = householdId</c> with
/// <c>RowKey = {cartWeekIso}_{itemId}</c> so a week's items read back as a
/// contiguous key range inside the partition. <see cref="ProductId"/> and
/// <see cref="SourceConnector"/> come from the G1 store connector, so the origin
/// of a line stays visible if a different connector is swapped in behind the seam.
/// </summary>
public sealed class CartItemEntity : ITableEntity
{
    /// <summary>The <c>householdId</c> (Table partition key).</summary>
    public string PartitionKey { get; set; } = string.Empty;

    /// <summary>The <c>{cartWeekIso}_{itemId}</c> composite (Table row key).</summary>
    public string RowKey { get; set; } = string.Empty;

    /// <summary>Service-assigned last-write timestamp.</summary>
    public DateTimeOffset? Timestamp { get; set; }

    /// <summary>Optimistic-concurrency version stamp.</summary>
    public ETag ETag { get; set; }

    /// <summary>The ISO-8601 year-week of the cart this item belongs to (for example <c>2026-W29</c>).</summary>
    public string CartWeekIso { get; set; } = string.Empty;

    /// <summary>The item's own id within the week's cart (the row key's second half).</summary>
    public string ItemId { get; set; } = string.Empty;

    /// <summary>The connector's opaque product id (G1).</summary>
    public string ProductId { get; set; } = string.Empty;

    /// <summary>The human-facing product name shown on the hub.</summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>How many of the product are in the cart.</summary>
    public int Quantity { get; set; }

    /// <summary>The <c>personId</c> who added the item (tap-to-claim participant or hub session).</summary>
    public string AddedByPersonId { get; set; } = string.Empty;

    /// <summary>The connector that produced the product (for example <c>simulated-heb</c>).</summary>
    public string SourceConnector { get; set; } = string.Empty;

    /// <summary>
    /// Builds the <c>{cartWeekIso}_{itemId}</c> composite row key. The one place
    /// the key shape is spelled out, so the week prefix a listing scans for and
    /// the key a write produces can never drift apart.
    /// </summary>
    /// <param name="cartWeekIso">The cart's ISO year-week (for example <c>2026-W29</c>).</param>
    /// <param name="itemId">The item's own id within that week's cart.</param>
    public static string RowKeyFor(string cartWeekIso, string itemId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(cartWeekIso);
        ArgumentException.ThrowIfNullOrWhiteSpace(itemId);
        return $"{cartWeekIso}_{itemId}";
    }

    /// <summary>
    /// The row-key prefix every item of one week's cart shares. The week is a
    /// fixed-shape <c>{year}-W{week}</c> token, so the prefix is unambiguous.
    /// </summary>
    /// <param name="cartWeekIso">The cart's ISO year-week (for example <c>2026-W29</c>).</param>
    public static string RowKeyPrefixFor(string cartWeekIso)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(cartWeekIso);
        return $"{cartWeekIso}_";
    }
}
