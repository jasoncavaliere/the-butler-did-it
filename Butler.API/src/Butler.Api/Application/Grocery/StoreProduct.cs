namespace Butler.Api.Application.Grocery;

/// <summary>
/// A store product as returned by an <see cref="IStoreConnector"/> to callers.
/// This is the stable, connector-agnostic shape the rest of the grocery flow
/// builds against, so a different connector (an aggregator/assisted or an
/// official store connector, BRD Section 9 fast-follow) can be swapped in behind
/// the seam without changing consumers.
/// </summary>
/// <param name="ProductId">The connector's opaque product id (stable within a connector).</param>
/// <param name="DisplayName">The human-facing product name.</param>
/// <param name="Size">The pack/quantity size (for example <c>"1"</c>, <c>"12"</c>).</param>
/// <param name="Unit">The unit the <see cref="Size"/> is expressed in (for example <c>"gal"</c>, <c>"ct"</c>).</param>
/// <param name="IndicativePrice">
/// An indicative price string for display only. It is <b>non-transactional</b>:
/// it is never a charge and carries no guarantee of the price at any real store.
/// </param>
/// <param name="SourceConnector">
/// The connector that produced this result (for example <c>"simulated-heb"</c>),
/// so a later connector can be identified and swapped in transparently.
/// </param>
public sealed record StoreProduct(
    string ProductId,
    string DisplayName,
    string Size,
    string Unit,
    string IndicativePrice,
    string SourceConnector);
