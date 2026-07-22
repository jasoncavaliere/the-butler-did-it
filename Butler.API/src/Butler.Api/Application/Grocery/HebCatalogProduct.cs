namespace Butler.Api.Application.Grocery;

/// <summary>
/// One entry in the checked-in simulated-HEB fixture catalog. Deserialized from
/// <c>SeedData/grocery/heb-catalog.json</c> by <see cref="HebCatalog"/>. Carries
/// the product fields plus <see cref="Synonyms"/>, alternate search terms the
/// connector matches in addition to <see cref="DisplayName"/>. Synonyms are a
/// search-matching concern only and are not surfaced on the returned
/// <see cref="StoreProduct"/>. Init-only properties with defaults so a missing
/// JSON field deserializes to a safe empty value rather than null.
/// </summary>
public sealed record HebCatalogProduct
{
    /// <summary>The product's stable, opaque id within the catalog.</summary>
    public string ProductId { get; init; } = string.Empty;

    /// <summary>The human-facing product name (also the primary search target).</summary>
    public string DisplayName { get; init; } = string.Empty;

    /// <summary>The pack/quantity size (for example <c>"1"</c>, <c>"12"</c>).</summary>
    public string Size { get; init; } = string.Empty;

    /// <summary>The unit the <see cref="Size"/> is expressed in (for example <c>"gal"</c>).</summary>
    public string Unit { get; init; } = string.Empty;

    /// <summary>Indicative, display-only price string (never a charge).</summary>
    public string IndicativePrice { get; init; } = string.Empty;

    /// <summary>Additional case-insensitive search terms for this product.</summary>
    public IReadOnlyList<string> Synonyms { get; init; } = [];
}
