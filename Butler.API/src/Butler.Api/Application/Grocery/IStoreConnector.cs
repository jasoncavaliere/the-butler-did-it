namespace Butler.Api.Application.Grocery;

/// <summary>
/// The store-connector seam (BRD decision D-4, Engineering Contract 7.2). Every
/// grocery consumer talks to a store through this interface, never a concrete
/// connector, so the v1 <see cref="SimulatedHebConnector"/> can be replaced by an
/// aggregator/assisted or an official store connector (BRD Section 9 fast-follow)
/// without touching callers. Results carry <see cref="StoreProduct.SourceConnector"/>
/// so the origin stays visible across a swap.
/// <para>
/// The methods are asynchronous because the seam must fit a future connector that
/// does real network I/O; the v1 simulated implementation resolves synchronously
/// over an in-memory fixture but honors the same contract.
/// </para>
/// </summary>
public interface IStoreConnector
{
    /// <summary>
    /// Searches the store for products matching <paramref name="query"/>
    /// (case-insensitive). Returns an empty list when nothing matches or the
    /// query is blank; never throws for a no-match.
    /// </summary>
    /// <param name="query">The free-text search term.</param>
    /// <param name="cancellationToken">A cancellation token.</param>
    /// <returns>The matching products, in a deterministic order.</returns>
    Task<IReadOnlyList<StoreProduct>> SearchProductsAsync(
        string query,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Reads a single product by its connector-specific id.
    /// </summary>
    /// <param name="productId">The product id to read.</param>
    /// <param name="cancellationToken">A cancellation token.</param>
    /// <returns>The product, or <c>null</c> when no product has that id.</returns>
    Task<StoreProduct?> GetProductAsync(
        string productId,
        CancellationToken cancellationToken = default);
}
