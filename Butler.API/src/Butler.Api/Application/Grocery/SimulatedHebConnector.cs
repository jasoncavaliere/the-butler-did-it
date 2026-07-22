namespace Butler.Api.Application.Grocery;

/// <summary>
/// The v1 <see cref="IStoreConnector"/> implementation (BRD decision D-4). HEB has
/// no public consumer API, so this searches a checked-in fixture catalog entirely
/// in memory - there is no network dependency of any kind. Search is
/// case-insensitive over each product's <see cref="HebCatalogProduct.DisplayName"/>
/// and its synonyms, and deterministic: results are ordered by display name then
/// product id, so the same query always yields the same ordered results. Every
/// result is stamped with <see cref="SourceName"/> so a later connector can be
/// swapped in behind the seam without consumers noticing.
/// </summary>
public sealed class SimulatedHebConnector : IStoreConnector
{
    /// <summary>The connector identity stamped on every result.</summary>
    public const string SourceName = "simulated-heb";

    private readonly IReadOnlyList<HebCatalogProduct> _catalog;

    /// <summary>
    /// Creates the connector over an in-memory catalog. In v1 the catalog is the
    /// checked-in fixture loaded by <see cref="HebCatalog.Load"/>; tests inject
    /// their own to exercise the search behaviour in isolation.
    /// </summary>
    /// <param name="catalog">The product catalog to search.</param>
    public SimulatedHebConnector(IReadOnlyList<HebCatalogProduct> catalog)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        _catalog = catalog;
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<StoreProduct>> SearchProductsAsync(
        string query,
        CancellationToken cancellationToken = default)
    {
        var trimmed = (query ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return Task.FromResult<IReadOnlyList<StoreProduct>>([]);
        }

        var matches = _catalog
            .Where(product => Matches(product, trimmed))
            // Stable, deterministic ordering independent of catalog file order.
            .OrderBy(product => product.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(product => product.ProductId, StringComparer.Ordinal)
            .Select(ToStoreProduct)
            .ToList();

        return Task.FromResult<IReadOnlyList<StoreProduct>>(matches);
    }

    /// <inheritdoc />
    public Task<StoreProduct?> GetProductAsync(
        string productId,
        CancellationToken cancellationToken = default)
    {
        var id = (productId ?? string.Empty).Trim();
        var match = _catalog.FirstOrDefault(
            product => string.Equals(product.ProductId, id, StringComparison.OrdinalIgnoreCase));

        return Task.FromResult(match is null ? null : ToStoreProduct(match));
    }

    // A product matches when the query is a case-insensitive substring of its
    // display name or of any of its synonyms.
    private static bool Matches(HebCatalogProduct product, string query) =>
        product.DisplayName.Contains(query, StringComparison.OrdinalIgnoreCase)
        || product.Synonyms.Any(synonym => synonym.Contains(query, StringComparison.OrdinalIgnoreCase));

    private static StoreProduct ToStoreProduct(HebCatalogProduct product) => new(
        product.ProductId,
        product.DisplayName,
        product.Size,
        product.Unit,
        product.IndicativePrice,
        SourceName);
}
