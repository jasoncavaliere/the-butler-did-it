using Butler.Api.Application.Capture;
using Butler.Api.Application.Carts;
using Butler.Api.Application.Grocery;
using Butler.Api.Infrastructure.Carts;
using NSubstitute;

namespace Butler.Api.Tests.Capture;

/// <summary>
/// Unit tests for the shared resolve-and-add handler over substituted seams. They
/// pin the parts the HTTP tests cannot see directly: which of several matches is
/// "the top match", that the cart row is advanced with the <c>ETag</c> the G2
/// get-or-create read handed back (cart optimistic concurrency), that the quantity
/// default is applied, and that every failing input writes nothing at all.
/// </summary>
public sealed class CaptureHandlerTests
{
    private const string Household = "household-1";
    private const string Week = "2026-W30";
    private const string ETag = "etag-1";

    private readonly ICartService _carts = Substitute.For<ICartService>();
    private readonly ICartRepository _cartRows = Substitute.For<ICartRepository>();
    private readonly ICartItemRepository _items = Substitute.For<ICartItemRepository>();
    private readonly IStoreConnector _store = Substitute.For<IStoreConnector>();

    private static StoreProduct Product(string productId, string displayName) =>
        new(productId, displayName, "1", "ea", "$1.00", "simulated-heb");

    private CaptureHandler NewHandler() => new(_carts, _cartRows, _items, _store);

    // The building cart G2's get-or-create hands back.
    private void GivenBuildingCart(string etag = ETag) =>
        _carts
            .GetOrCreateBuildingCartAsync(Household, Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .Returns(new CartResponse(Week, CartStatus.Building, null, null, etag, []));

    private void GivenMatches(params StoreProduct[] matches) =>
        _store
            .SearchProductsAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(matches.ToList());

    private Task<CaptureResult> CaptureAsync(string utterance, int? quantity = null) =>
        NewHandler().ResolveAndAddAsync(
            CaptureSourceNames.HubText,
            new CaptureRequest(Household, utterance, "person-1", Week, quantity),
            CancellationToken.None);

    [Fact]
    public async Task A_single_match_is_added_with_the_products_source_connector()
    {
        GivenBuildingCart();
        GivenMatches(Product("heb-0003", "H-E-B Grade A Large Eggs"));

        var result = await CaptureAsync("add eggs");

        Assert.Equal(CaptureOutcome.Added, result.Outcome);
        Assert.Equal("eggs", result.ResolvedTerm);
        Assert.Equal(Week, result.WeekIso);
        Assert.NotNull(result.Item);
        Assert.Equal("heb-0003", result.Item!.ProductId);
        Assert.Equal(CaptureHandler.DefaultQuantity, result.Item.Quantity);
        Assert.Equal("person-1", result.Item.AddedByPersonId);
        Assert.Equal("simulated-heb", result.Item.SourceConnector);

        await _items
            .Received(1)
            .AddAsync(
                Household,
                Arg.Is<CartItemEntity>(item =>
                    item.PartitionKey == Household
                    && item.CartWeekIso == Week
                    && item.RowKey == CartItemEntity.RowKeyFor(Week, item.ItemId)
                    && item.ProductId == "heb-0003"
                    && item.DisplayName == "H-E-B Grade A Large Eggs"
                    && item.Quantity == 1
                    && item.AddedByPersonId == "person-1"
                    && item.SourceConnector == "simulated-heb"),
                Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task An_exact_display_name_wins_over_the_other_candidates()
    {
        GivenBuildingCart();
        GivenMatches(
            Product("p-1", "Oat Milk Barista Edition"),
            Product("p-2", "Oat Milk"),
            Product("p-3", "Oat Milk Chocolate"));

        var result = await CaptureAsync("add Oat Milk");

        // Several matches, but one of them is exactly what was asked for: that is
        // the top match, not an ambiguity.
        Assert.Equal(CaptureOutcome.Added, result.Outcome);
        Assert.Equal("p-2", result.Item!.ProductId);
    }

    [Fact]
    public async Task The_cart_row_is_advanced_under_the_etag_from_the_get_or_create_read()
    {
        GivenBuildingCart("etag-from-read");
        GivenMatches(Product("heb-0013", "H-E-B Long Grain White Rice"));

        await CaptureAsync("add rice");

        await _cartRows
            .Received(1)
            .UpdateAsync(
                Household,
                Arg.Is<CartEntity>(cart =>
                    cart.PartitionKey == Household
                    && cart.RowKey == Week
                    && cart.Status == CartStatus.Building
                    && cart.ConfirmedByPersonId == null
                    && cart.ConfirmedUtc == null),
                "etag-from-read",
                Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(null, 1)]
    [InlineData(0, 1)]
    [InlineData(-3, 1)]
    [InlineData(1, 1)]
    [InlineData(4, 4)]
    public async Task The_quantity_defaults_to_one_unless_a_positive_one_is_supplied(int? requested, int expected)
    {
        GivenBuildingCart();
        GivenMatches(Product("heb-0010", "H-E-B Creamy Peanut Butter"));

        var result = await CaptureAsync("add peanut butter", requested);

        Assert.Equal(expected, result.Item!.Quantity);
    }

    [Fact]
    public async Task An_utterance_with_no_product_term_touches_no_seam()
    {
        var result = await CaptureAsync("add");

        Assert.Equal(CaptureOutcome.EmptyTerm, result.Outcome);
        Assert.Equal(string.Empty, result.ResolvedTerm);
        Assert.Null(result.WeekIso);
        Assert.Null(result.Item);
        Assert.Empty(result.Suggestions);

        // No cart is created for an utterance that said nothing.
        await _carts
            .DidNotReceive()
            .GetOrCreateBuildingCartAsync(
                Arg.Any<string>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
        await _store
            .DidNotReceive()
            .SearchProductsAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
        await AssertNothingWrittenAsync();
    }

    [Fact]
    public async Task An_unknown_household_reports_itself_and_writes_nothing()
    {
        _carts
            .GetOrCreateBuildingCartAsync(Household, Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .Returns((CartResponse?)null);

        var result = await CaptureAsync("add eggs");

        Assert.Equal(CaptureOutcome.HouseholdNotFound, result.Outcome);
        Assert.Equal("eggs", result.ResolvedTerm);
        Assert.Null(result.WeekIso);
        await AssertNothingWrittenAsync();
    }

    [Fact]
    public async Task A_no_match_writes_nothing()
    {
        GivenBuildingCart();
        GivenMatches();

        var result = await CaptureAsync("add unicorn steaks");

        Assert.Equal(CaptureOutcome.NoMatch, result.Outcome);
        Assert.Equal("unicorn steaks", result.ResolvedTerm);
        Assert.Equal(Week, result.WeekIso);
        Assert.Empty(result.Suggestions);
        await AssertNothingWrittenAsync();
    }

    [Fact]
    public async Task Several_equally_plausible_matches_come_back_as_suggestions()
    {
        GivenBuildingCart();
        GivenMatches(
            Product("heb-0001", "H-E-B Whole Milk"),
            Product("heb-0002", "H-E-B 2% Reduced Fat Milk"));

        var result = await CaptureAsync("add milk");

        Assert.Equal(CaptureOutcome.Ambiguous, result.Outcome);
        Assert.Null(result.Item);
        Assert.Equal(2, result.Suggestions.Count);
        Assert.Equal("heb-0001", result.Suggestions[0].ProductId);
        Assert.Equal("heb-0002", result.Suggestions[1].ProductId);
        await AssertNothingWrittenAsync();
    }

    [Fact]
    public void The_handler_rejects_missing_collaborators()
    {
        Assert.Throws<ArgumentNullException>(() => new CaptureHandler(null!, _cartRows, _items, _store));
        Assert.Throws<ArgumentNullException>(() => new CaptureHandler(_carts, null!, _items, _store));
        Assert.Throws<ArgumentNullException>(() => new CaptureHandler(_carts, _cartRows, null!, _store));
        Assert.Throws<ArgumentNullException>(() => new CaptureHandler(_carts, _cartRows, _items, null!));
    }

    [Fact]
    public async Task The_handler_rejects_incomplete_requests()
    {
        var handler = NewHandler();
        var request = new CaptureRequest(Household, "add eggs", "person-1");

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => handler.ResolveAndAddAsync(CaptureSourceNames.HubText, null!, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(
            () => handler.ResolveAndAddAsync(" ", request, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(
            () => handler.ResolveAndAddAsync(
                CaptureSourceNames.HubText,
                request with { HouseholdId = " " },
                CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(
            () => handler.ResolveAndAddAsync(
                CaptureSourceNames.HubText,
                request with { PersonId = " " },
                CancellationToken.None));
    }

    private async Task AssertNothingWrittenAsync()
    {
        await _items
            .DidNotReceive()
            .AddAsync(Arg.Any<string>(), Arg.Any<CartItemEntity>(), Arg.Any<CancellationToken>());
        await _cartRows
            .DidNotReceive()
            .UpdateAsync(
                Arg.Any<string>(), Arg.Any<CartEntity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }
}
