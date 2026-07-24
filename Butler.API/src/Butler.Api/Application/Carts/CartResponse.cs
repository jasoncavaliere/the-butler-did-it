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
    IReadOnlyList<CartItemView> Items);

/// <summary>
/// One line item in a <see cref="CartResponse"/>. <see cref="ProductId"/> and
/// <see cref="SourceConnector"/> come from the G1 store connector, so the origin
/// of the line survives a connector swap.
/// </summary>
/// <param name="ItemId">The item's id within the week's cart.</param>
/// <param name="ProductId">The connector's opaque product id.</param>
/// <param name="DisplayName">The human-facing product name.</param>
/// <param name="Quantity">How many of the product are in the cart.</param>
/// <param name="AddedByPersonId">The person who added the item.</param>
/// <param name="SourceConnector">The connector that produced the product (for example <c>simulated-heb</c>).</param>
public sealed record CartItemView(
    string ItemId,
    string ProductId,
    string DisplayName,
    int Quantity,
    string AddedByPersonId,
    string SourceConnector);

/// <summary>
/// The outcome of reading one week's cart. A cart read has three distinguishable
/// answers - the household does not exist, it exists but that week has no cart
/// yet, or here is the cart - and the controller maps each to its own RFC 7807
/// document rather than collapsing two different <c>404</c>s into one message.
/// </summary>
/// <param name="HouseholdExists">Whether the household itself exists.</param>
/// <param name="Cart">The week's cart, or <c>null</c> when the week has none.</param>
public sealed record CartReadResult(bool HouseholdExists, CartResponse? Cart);
