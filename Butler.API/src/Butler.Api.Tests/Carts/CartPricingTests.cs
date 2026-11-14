using Butler.Api.Application.Carts;

namespace Butler.Api.Tests.Carts;

/// <summary>
/// Criterion (#113 AC9): the cart's estimated total is quantity times the parsed
/// indicative price, summed over the catalog lines only. Prices are parsed from
/// what the capture recorded (culture-invariant), never looked up.
/// </summary>
public sealed class CartPricingTests
{
    private static CartItemView Catalog(int quantity, string? price) =>
        new(Guid.NewGuid().ToString("N"), "heb-1", "Thing", quantity, "p", "simulated-heb", price);

    private static CartItemView Custom(int quantity) =>
        new(Guid.NewGuid().ToString("N"), null, "Custom", quantity, "p", CartItemSources.Custom, null, IsCustom: true);

    [Theory]
    [InlineData("$3.79", 3.79)]
    [InlineData(" $0.89 ", 0.89)]
    [InlineData("$12", 12)]
    public void Parses_a_dollar_price(string text, double expected)
    {
        Assert.True(CartPricing.TryParseIndicativePrice(text, out var price));
        Assert.Equal((decimal)expected, price);
    }

    [Theory]
    [InlineData("3.79", 3.79)]
    [InlineData("1.5", 1.5)]
    public void Parses_a_bare_price(string text, double expected)
    {
        Assert.True(CartPricing.TryParseIndicativePrice(text, out var price));
        Assert.Equal((decimal)expected, price);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("free")]
    [InlineData("$")]
    [InlineData("-1.00")]
    [InlineData("1,000.00")]
    public void Rejects_blank_null_and_garbage(string? text)
    {
        Assert.False(CartPricing.TryParseIndicativePrice(text, out var price));
        Assert.Equal(0m, price);
    }

    [Fact]
    public void Estimated_total_sums_quantity_times_price_over_catalog_items_only()
    {
        var total = CartPricing.EstimatedTotal(
        [
            Catalog(2, "$3.79"),
            Catalog(1, "$1.89"),
            Custom(5),
        ]);

        Assert.Equal(9.47m, total);
    }

    [Fact]
    public void A_catalog_line_with_no_price_contributes_nothing()
    {
        var total = CartPricing.EstimatedTotal([Catalog(3, null), Catalog(1, "n/a"), Catalog(1, "$0.89")]);

        Assert.Equal(0.89m, total);
    }

    [Fact]
    public void An_empty_cart_totals_zero()
    {
        Assert.Equal(0m, CartPricing.EstimatedTotal([]));
    }

    [Fact]
    public void Estimated_total_rejects_a_missing_item_list()
    {
        Assert.Throws<ArgumentNullException>(() => CartPricing.EstimatedTotal(null!));
    }
}
