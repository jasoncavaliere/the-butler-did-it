using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Butler.Api.Application.Carts;
using Butler.Api.Application.Grocery;

namespace Butler.Api.Tests.Grocery;

/// <summary>
/// Tests for <see cref="HebCatalog"/>: the checked-in fixture is embedded and
/// loads offline with 180-220 uniquely identified products (#114 AC1), each in
/// one of the six categories (AC2) with every category populated (AC3), fully
/// populated (AC4), priced in the existing <c>$d.dd</c> form (AC5), and pointing
/// at a bundled per-category SVG icon (AC6). A missing resource is a loud
/// failure, and JSON that deserializes to null is rejected.
/// </summary>
public sealed class HebCatalogTests
{
    private static readonly HashSet<string> Categories = new(StringComparer.Ordinal)
    {
        "produce",
        "dairy",
        "pantry",
        "frozen",
        "household",
        "kids",
    };

    private static readonly Regex DollarPrice = new(@"^\$\d{1,3}\.\d{2}$", RegexOptions.CultureInvariant);

    [Fact]
    public void Load_reads_between_180_and_220_products_with_unique_ids()
    {
        var catalog = HebCatalog.Load();

        Assert.InRange(catalog.Count, 180, 220);
        Assert.Equal(
            catalog.Count,
            catalog.Select(product => product.ProductId).Distinct(StringComparer.OrdinalIgnoreCase).Count());

        // Exact display-name resolution picks the first hit, so names must be
        // unique too or a capture could silently land on the wrong product.
        Assert.Equal(
            catalog.Count,
            catalog.Select(product => product.DisplayName).Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [Fact]
    public void Load_gives_every_product_one_of_the_six_categories()
    {
        var catalog = HebCatalog.Load();

        Assert.All(catalog, product => Assert.Contains(product.Category, Categories));
    }

    [Fact]
    public void Load_puts_at_least_one_product_in_every_category()
    {
        var populated = HebCatalog.Load()
            .Select(product => product.Category)
            .ToHashSet(StringComparer.Ordinal);

        Assert.All(Categories, category => Assert.Contains(category, populated));
    }

    [Fact]
    public void Load_prices_every_product_in_dollar_form()
    {
        var catalog = HebCatalog.Load();

        Assert.All(catalog, product =>
        {
            Assert.Matches(DollarPrice, product.IndicativePrice);
            Assert.True(
                CartPricing.TryParseIndicativePrice(product.IndicativePrice, out var price),
                $"{product.ProductId} price '{product.IndicativePrice}' did not parse.");
            Assert.True(price > 0m, $"{product.ProductId} price must be positive.");
        });
    }

    [Fact]
    public void Load_points_every_iconId_at_a_bundled_per_category_svg()
    {
        var catalog = HebCatalog.Load();
        var assembly = typeof(HebCatalog).Assembly;

        // One icon per category: the icon id is the category name.
        Assert.All(catalog, product => Assert.Equal(product.Category, product.IconId));

        var iconIds = catalog.Select(product => product.IconId).Distinct(StringComparer.Ordinal).ToArray();
        Assert.Equal(Categories.Count, iconIds.Length);

        Assert.All(iconIds, iconId =>
        {
            var resourceName = $"{HebCatalog.IconResourcePrefix}{iconId}.svg";
            using var stream = assembly.GetManifestResourceStream(resourceName);
            Assert.True(stream is not null, $"Icon resource '{resourceName}' is not embedded.");

            var svg = XDocument.Load(stream);
            var root = svg.Root!;
            Assert.Equal("svg", root.Name.LocalName);

            // Self-contained, inert artwork: no raster or remote images, no
            // script, and no links out of the file.
            var elements = root.DescendantsAndSelf().ToArray();
            Assert.DoesNotContain(elements, element => element.Name.LocalName is "image" or "script" or "foreignObject");
            Assert.DoesNotContain(
                elements.SelectMany(element => element.Attributes()),
                attribute => attribute.Name.LocalName == "href");
        });
    }

    [Fact]
    public void Load_reads_fully_populated_products()
    {
        var catalog = HebCatalog.Load();

        Assert.All(catalog, product =>
        {
            Assert.False(string.IsNullOrWhiteSpace(product.ProductId));
            Assert.False(string.IsNullOrWhiteSpace(product.DisplayName));
            Assert.False(string.IsNullOrWhiteSpace(product.Size));
            Assert.False(string.IsNullOrWhiteSpace(product.Unit));
            Assert.False(string.IsNullOrWhiteSpace(product.IndicativePrice));
            Assert.False(string.IsNullOrWhiteSpace(product.Category));
            Assert.False(string.IsNullOrWhiteSpace(product.IconId));
        });
    }

    [Fact]
    public void LoadFromResource_throws_when_the_resource_is_missing()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => HebCatalog.LoadFromResource("Butler.Api.SeedData.grocery.does-not-exist.json"));

        Assert.Contains("does-not-exist", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_throws_when_the_json_deserializes_to_null()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("null"));

        Assert.Throws<InvalidOperationException>(() => HebCatalog.Parse(stream));
    }

    [Fact]
    public void Parse_reads_products_from_a_json_array()
    {
        const string json = """
            [
              { "productId": "x-1", "displayName": "Test Item", "size": "1", "unit": "ea", "indicativePrice": "$1.00", "category": "pantry", "iconId": "pantry", "synonyms": ["thing"] }
            ]
            """;
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));

        var catalog = HebCatalog.Parse(stream);

        var product = Assert.Single(catalog);
        Assert.Equal("x-1", product.ProductId);
        Assert.Equal("pantry", product.Category);
        Assert.Equal("pantry", product.IconId);
        Assert.Equal(["thing"], product.Synonyms);
    }
}
