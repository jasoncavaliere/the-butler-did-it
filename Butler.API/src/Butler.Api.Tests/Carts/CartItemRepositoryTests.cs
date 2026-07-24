using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Tests.Carts;

/// <summary>
/// Criteria (G2): the <c>CartItems</c> table row is
/// <c>PartitionKey = householdId</c> / <c>RowKey = {cartWeekIso}_{itemId}</c> with
/// <c>ProductId</c>, <c>DisplayName</c>, <c>Quantity</c>, <c>AddedByPersonId</c>,
/// and <c>SourceConnector</c>, reached only through
/// <see cref="ICartItemRepository"/>. Add-then-list round-trips every field, one
/// week's listing never bleeds into another week's, and no read crosses a
/// household boundary.
/// </summary>
public sealed class CartItemRepositoryTests
{
    private const string Week = "2026-W29";
    private const string OtherWeek = "2026-W30";

    // Both of the target week's items, in the row-key order the listing promises.
    private static readonly string[] ExpectedWeekItemIds = { "item-a", "item-b" };

    private static TableCartItemRepository NewRepository() =>
        new(new InMemoryEntityRepository<CartItemEntity>());

    private static CartItemEntity Item(
        string weekIso,
        string itemId,
        string productId = "heb-oat-milk",
        string displayName = "Oat Milk",
        int quantity = 1,
        string addedBy = "person-1",
        string source = "simulated-heb") => new()
        {
            RowKey = CartItemEntity.RowKeyFor(weekIso, itemId),
            CartWeekIso = weekIso,
            ItemId = itemId,
            ProductId = productId,
            DisplayName = displayName,
            Quantity = quantity,
            AddedByPersonId = addedBy,
            SourceConnector = source,
        };

    [Fact]
    public async Task Add_then_list_round_trips_every_field()
    {
        var repository = NewRepository();

        await repository.AddAsync(
            "house-1",
            Item(Week, "item-1", "heb-oat-milk", "Oat Milk, Half Gallon", 2, "person-7", "simulated-heb"),
            CancellationToken.None);

        var listed = await repository.ListForWeekAsync("house-1", Week, CancellationToken.None);

        var stored = Assert.Single(listed);
        Assert.Equal("house-1", stored.PartitionKey);
        Assert.Equal($"{Week}_item-1", stored.RowKey);
        Assert.Equal(Week, stored.CartWeekIso);
        Assert.Equal("item-1", stored.ItemId);
        Assert.Equal("heb-oat-milk", stored.ProductId);
        Assert.Equal("Oat Milk, Half Gallon", stored.DisplayName);
        Assert.Equal(2, stored.Quantity);
        Assert.Equal("person-7", stored.AddedByPersonId);
        Assert.Equal("simulated-heb", stored.SourceConnector);
    }

    [Fact]
    public async Task Add_then_get_reads_one_item_by_its_composite_key()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", Item(Week, "item-1"), CancellationToken.None);

        var stored = await repository.GetAsync(
            "house-1",
            CartItemEntity.RowKeyFor(Week, "item-1"),
            CancellationToken.None);

        Assert.NotNull(stored);
        Assert.Equal("Oat Milk", stored!.DisplayName);
        Assert.Null(await repository.GetAsync("house-1", $"{Week}_missing", CancellationToken.None));
    }

    [Fact]
    public async Task Listing_a_week_returns_only_that_weeks_items_in_key_order()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", Item(Week, "item-b"), CancellationToken.None);
        await repository.AddAsync("house-1", Item(Week, "item-a"), CancellationToken.None);
        await repository.AddAsync("house-1", Item(OtherWeek, "item-c"), CancellationToken.None);

        var listed = await repository.ListForWeekAsync("house-1", Week, CancellationToken.None);

        // Only the target week, and deterministically ordered by row key.
        Assert.Equal(ExpectedWeekItemIds, listed.Select(item => item.ItemId).ToArray());
    }

    [Fact]
    public async Task Listing_does_not_cross_household_boundaries()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", Item(Week, "item-1"), CancellationToken.None);
        await repository.AddAsync("house-2", Item(Week, "item-2"), CancellationToken.None);

        var listed = await repository.ListForWeekAsync("house-1", Week, CancellationToken.None);

        Assert.Equal("item-1", Assert.Single(listed).ItemId);
    }

    [Fact]
    public async Task A_week_with_no_items_lists_empty()
    {
        var repository = NewRepository();

        Assert.Empty(await repository.ListForWeekAsync("house-1", Week, CancellationToken.None));
    }

    [Fact]
    public void RowKeyFor_and_its_prefix_agree_on_the_composite_key_shape()
    {
        Assert.Equal($"{Week}_item-1", CartItemEntity.RowKeyFor(Week, "item-1"));
        Assert.StartsWith(
            CartItemEntity.RowKeyPrefixFor(Week),
            CartItemEntity.RowKeyFor(Week, "item-1"),
            StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null, "item-1")]
    [InlineData("", "item-1")]
    [InlineData(Week, null)]
    [InlineData(Week, "")]
    public void RowKeyFor_rejects_a_blank_part(string? weekIso, string? itemId)
    {
        Assert.ThrowsAny<ArgumentException>(() => CartItemEntity.RowKeyFor(weekIso!, itemId!));
    }

    [Fact]
    public void RowKeyPrefixFor_rejects_a_blank_week()
    {
        Assert.ThrowsAny<ArgumentException>(() => CartItemEntity.RowKeyPrefixFor(string.Empty));
    }

    [Fact]
    public void Constructor_rejects_a_null_inner_repository()
    {
        Assert.Throws<ArgumentNullException>(() => new TableCartItemRepository(null!));
    }

    [Fact]
    public async Task AddAsync_rejects_a_null_item_or_a_blank_key()
    {
        var repository = NewRepository();

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => repository.AddAsync("house-1", null!, CancellationToken.None));

        var blank = Item(Week, "item-1");
        blank.RowKey = string.Empty;
        await Assert.ThrowsAsync<ArgumentException>(
            () => repository.AddAsync("house-1", blank, CancellationToken.None));
    }

    [Theory]
    [InlineData(null, "2026-W29_item-1")]
    [InlineData("", "2026-W29_item-1")]
    [InlineData("house-1", null)]
    [InlineData("house-1", "")]
    public async Task GetAsync_rejects_a_blank_scope(string? householdId, string? rowKey)
    {
        var repository = NewRepository();

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => repository.GetAsync(householdId!, rowKey!, CancellationToken.None));
    }

    [Theory]
    [InlineData(null, Week)]
    [InlineData("", Week)]
    [InlineData("house-1", null)]
    [InlineData("house-1", "")]
    public async Task ListForWeekAsync_rejects_a_blank_scope(string? householdId, string? weekIso)
    {
        var repository = NewRepository();

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => repository.ListForWeekAsync(householdId!, weekIso!, CancellationToken.None));
    }
}
