using Butler.Api.Application.Grocery;

namespace Butler.Api.Tests.Grocery;

/// <summary>
/// Unit tests for <see cref="SimulatedHebConnector"/> over a small in-memory
/// catalog. They pin the AC: search matches (including case-insensitive and
/// synonym matches), a no-match returns an empty list rather than throwing,
/// get-by-id for known and unknown ids, that every result carries the
/// <c>simulated-heb</c> source, and that repeated identical queries return
/// identical ordered results (determinism).
/// </summary>
public sealed class SimulatedHebConnectorTests
{
    private static readonly IReadOnlyList<HebCatalogProduct> Catalog =
    [
        new HebCatalogProduct
        {
            ProductId = "heb-b",
            DisplayName = "Whole Milk",
            Size = "1",
            Unit = "gal",
            IndicativePrice = "$3.29",
            Synonyms = ["dairy"],
        },
        new HebCatalogProduct
        {
            ProductId = "heb-a",
            DisplayName = "2% Reduced Fat Milk",
            Size = "1",
            Unit = "gal",
            IndicativePrice = "$3.19",
            Synonyms = ["dairy", "low fat"],
        },
        new HebCatalogProduct
        {
            ProductId = "heb-c",
            DisplayName = "Large Eggs",
            Size = "12",
            Unit = "ct",
            IndicativePrice = "$2.49",
            Synonyms = ["dozen"],
        },
    ];

    private static SimulatedHebConnector NewConnector() => new(Catalog);

    [Fact]
    public void Constructor_rejects_a_null_catalog()
    {
        Assert.Throws<ArgumentNullException>(() => new SimulatedHebConnector(null!));
    }

    [Fact]
    public async Task SearchProductsAsync_returns_a_product_matching_the_display_name()
    {
        var results = await NewConnector().SearchProductsAsync("Large Eggs", CancellationToken.None);

        var product = Assert.Single(results);
        Assert.Equal("heb-c", product.ProductId);
        Assert.Equal("Large Eggs", product.DisplayName);
        Assert.Equal("12", product.Size);
        Assert.Equal("ct", product.Unit);
        Assert.Equal("$2.49", product.IndicativePrice);
    }

    [Fact]
    public async Task SearchProductsAsync_is_case_insensitive()
    {
        var results = await NewConnector().SearchProductsAsync("large eggs", CancellationToken.None);

        Assert.Equal("heb-c", Assert.Single(results).ProductId);
    }

    [Fact]
    public async Task SearchProductsAsync_matches_a_synonym()
    {
        // "dairy" is a synonym of both milk products, not a substring of any name.
        var results = await NewConnector().SearchProductsAsync("DAIRY", CancellationToken.None);

        Assert.Equal(
            ["heb-a", "heb-b"],
            results.Select(product => product.ProductId).ToArray());
    }

    [Fact]
    public async Task SearchProductsAsync_returns_empty_when_nothing_matches()
    {
        var results = await NewConnector().SearchProductsAsync("kombucha", CancellationToken.None);

        Assert.Empty(results);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task SearchProductsAsync_returns_empty_for_a_blank_query(string query)
    {
        var results = await NewConnector().SearchProductsAsync(query, CancellationToken.None);

        Assert.Empty(results);
    }

    [Fact]
    public async Task SearchProductsAsync_returns_empty_for_a_null_query()
    {
        var results = await NewConnector().SearchProductsAsync(null!, CancellationToken.None);

        Assert.Empty(results);
    }

    [Fact]
    public async Task SearchProductsAsync_orders_results_deterministically_by_display_name()
    {
        // "milk" matches both milk products; the "2%" product sorts before "Whole".
        var results = await NewConnector().SearchProductsAsync("milk", CancellationToken.None);

        Assert.Equal(
            ["heb-a", "heb-b"],
            results.Select(product => product.ProductId).ToArray());
    }

    [Fact]
    public async Task SearchProductsAsync_is_deterministic_across_repeated_calls()
    {
        var connector = NewConnector();

        var first = await connector.SearchProductsAsync("milk", CancellationToken.None);
        var second = await connector.SearchProductsAsync("milk", CancellationToken.None);

        Assert.Equal(
            first.Select(product => product.ProductId).ToArray(),
            second.Select(product => product.ProductId).ToArray());
    }

    [Fact]
    public async Task SearchProductsAsync_stamps_the_source_connector_on_every_result()
    {
        var results = await NewConnector().SearchProductsAsync("milk", CancellationToken.None);

        Assert.NotEmpty(results);
        Assert.All(results, product => Assert.Equal("simulated-heb", product.SourceConnector));
    }

    [Fact]
    public async Task GetProductAsync_returns_the_product_for_a_known_id()
    {
        var product = await NewConnector().GetProductAsync("heb-b", CancellationToken.None);

        Assert.NotNull(product);
        Assert.Equal("Whole Milk", product!.DisplayName);
        Assert.Equal("simulated-heb", product.SourceConnector);
    }

    [Fact]
    public async Task GetProductAsync_returns_null_for_an_unknown_id()
    {
        var product = await NewConnector().GetProductAsync("heb-zzzz", CancellationToken.None);

        Assert.Null(product);
    }
}
