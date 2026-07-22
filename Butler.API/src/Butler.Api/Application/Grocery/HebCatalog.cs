using System.Text.Json;

namespace Butler.Api.Application.Grocery;

/// <summary>
/// Loads the checked-in simulated-HEB fixture catalog. The catalog is embedded in
/// this assembly (see <c>Butler.Api.csproj</c>), so loading is fully offline with
/// no file-system or network dependency. Reading the resource and parsing the JSON
/// are split so both the resource-found and resource-missing paths are directly
/// testable.
/// </summary>
internal static class HebCatalog
{
    /// <summary>The manifest name of the embedded catalog resource.</summary>
    internal const string ResourceName = "Butler.Api.SeedData.grocery.heb-catalog.json";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>Loads the v1 fixture catalog embedded in this assembly.</summary>
    public static IReadOnlyList<HebCatalogProduct> Load() => LoadFromResource(ResourceName);

    /// <summary>
    /// Loads a catalog from a named embedded resource in this assembly. Throws when
    /// the resource does not exist.
    /// </summary>
    internal static IReadOnlyList<HebCatalogProduct> LoadFromResource(string resourceName)
    {
        using var stream = typeof(HebCatalog).Assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException(
                $"Embedded store catalog resource '{resourceName}' was not found.");

        return Parse(stream);
    }

    /// <summary>Parses a catalog from a JSON stream (a top-level array of products).</summary>
    internal static IReadOnlyList<HebCatalogProduct> Parse(Stream json) =>
        JsonSerializer.Deserialize<List<HebCatalogProduct>>(json, JsonOptions)
            ?? throw new InvalidOperationException("The store catalog JSON deserialized to null.");
}
