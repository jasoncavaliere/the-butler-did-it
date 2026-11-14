namespace Butler.Api.Application.Carts;

/// <summary>
/// A week's grocery cart as returned to callers: the cart row and its items in
/// one response shape, so the hub renders "the cart" from a single read. The
/// <see cref="ETag"/> is the cart's current optimistic-concurrency version, which
/// the G4 confirm supplies back as <c>If-Match</c> (Engineering Contract 7.3) -
/// which is why the review read and the confirm are two halves of one gesture.
/// </summary>
/// <param name="WeekIso">The ISO-8601 year-week the cart belongs to (for example <c>2026-W29</c>).</param>
/// <param name="Status">Lifecycle state: <c>Building</c> or <c>Confirmed</c>.</param>
/// <param name="ConfirmedByPersonId">The organizer who confirmed the cart; <c>null</c> while building.</param>
/// <param name="ConfirmedUtc">When the cart was confirmed, in UTC; <c>null</c> while building.</param>
/// <param name="ETag">The cart's current optimistic-concurrency version stamp.</param>
/// <param name="Items">The cart's line items, ordered deterministically by item key.</param>
public sealed record CartResponse(
    string WeekIso,
    string Status,
    string? ConfirmedByPersonId,
    DateTimeOffset? ConfirmedUtc,
    string ETag,
    IReadOnlyList<CartItemView> Items)
{
    /// <summary>
    /// The estimated total: quantity times the parsed indicative price, summed
    /// over the catalog items. Custom items are not priced, so they add nothing
    /// (see <see cref="CustomItemCount"/>).
    /// </summary>
    public decimal EstimatedTotal => CartPricing.EstimatedTotal(Items);

    /// <summary>How many of the cart's items are custom (unpriced) lines.</summary>
    public int CustomItemCount => Items.Count(item => item.IsCustom);
}

/// <summary>
/// One line item in a <see cref="CartResponse"/>. <see cref="ProductId"/> and
/// <see cref="SourceConnector"/> come from the G1 store connector, so the origin
/// of the line survives a connector swap. A custom line (<see cref="IsCustom"/>)
/// matched no catalog product: it has no product id and no price, and its
/// source connector is <see cref="CartItemSources.Custom"/>.
/// </summary>
/// <param name="ItemId">The item's id within the week's cart.</param>
/// <param name="ProductId">The connector's opaque product id; <c>null</c> for a custom line.</param>
/// <param name="DisplayName">The human-facing product name.</param>
/// <param name="Quantity">How many of the product are in the cart.</param>
/// <param name="AddedByPersonId">The person who added the item.</param>
/// <param name="SourceConnector">The connector that produced the product (for example <c>simulated-heb</c>).</param>
/// <param name="IndicativePrice">
/// The connector's indicative unit price when the line was added (for example
/// <c>$3.79</c>); <c>null</c> for a custom line or a line with no recorded price.
/// </param>
/// <param name="IsCustom">Whether the line is a shopper-typed custom item.</param>
public sealed record CartItemView(
    string ItemId,
    string? ProductId,
    string DisplayName,
    int Quantity,
    string AddedByPersonId,
    string SourceConnector,
    string? IndicativePrice = null,
    bool IsCustom = false);

/// <summary>
/// Well-known <see cref="CartItemView.SourceConnector"/> values that do not come
/// from a store connector.
/// </summary>
public static class CartItemSources
{
    /// <summary>The source of a shopper-typed custom line that matched no catalog product.</summary>
    public const string Custom = "custom";
}

/// <summary>
/// The outcome of reading one week's cart. A cart read has three distinguishable
/// answers - the household does not exist, it exists but that week has no cart
/// yet, or here is the cart - and the controller maps each to its own RFC 7807
/// document rather than collapsing two different <c>404</c>s into one message.
/// </summary>
/// <param name="HouseholdExists">Whether the household itself exists.</param>
/// <param name="Cart">The week's cart, or <c>null</c> when the week has none.</param>
public sealed record CartReadResult(bool HouseholdExists, CartResponse? Cart);
