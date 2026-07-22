using System.Text;
using Butler.Api.Application.Grocery;

namespace Butler.Api.Tests.Grocery;

/// <summary>
/// Tests for <see cref="HebCatalog"/>: the checked-in fixture is embedded and
/// loads offline with at least a dozen products (AC), a missing resource is a
/// loud failure, and JSON that deserializes to null is rejected.
/// </summary>
public sealed class HebCatalogTests
{
    [Fact]
    public void Load_reads_at_least_a_dozen_products_from_the_embedded_fixture()
    {
        var catalog = HebCatalog.Load();

        Assert.True(
            catalog.Count >= 12,
            $"Expected the fixture catalog to hold at least 12 products but found {catalog.Count}.");
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
              { "productId": "x-1", "displayName": "Test Item", "size": "1", "unit": "ea", "indicativePrice": "$1.00", "synonyms": ["thing"] }
            ]
            """;
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));

        var catalog = HebCatalog.Parse(stream);

        var product = Assert.Single(catalog);
        Assert.Equal("x-1", product.ProductId);
        Assert.Equal(["thing"], product.Synonyms);
    }
}
