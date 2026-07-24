using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Carts;
using Butler.Api.Domain.Scheduling;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Carts;

/// <summary>
/// Criteria (G2): the get-or-create operation hands back the household's
/// <c>Building</c> cart for the current week - creating it when the week has none,
/// returning the same single row on every later call, and never presenting a
/// <c>Confirmed</c> cart as the building cart. The week itself is deterministic:
/// it comes from the injected clock, or from a caller-supplied <c>weekIso</c>
/// that is validated before use (Engineering Contract 7.5).
/// </summary>
public sealed class CartServiceTests
{
    // A Wednesday: ISO week 2026-W29 (Monday 2026-07-13 .. Sunday 2026-07-19).
    private static readonly DateTimeOffset Now = new(2026, 7, 15, 8, 0, 0, TimeSpan.Zero);
    private const string CurrentWeek = "2026-W29";
    private const string HouseholdId = "house-1";

    private sealed class Fixture
    {
        public Fixture(DateTimeOffset now)
        {
            Clock = new MutableClock(now);
            Households = new TableHouseholdRepository(new InMemoryEntityRepository<HouseholdEntity>());
            CartRepository = new TableCartRepository(new InMemoryEntityRepository<CartEntity>());
            ItemRepository = new TableCartItemRepository(new InMemoryEntityRepository<CartItemEntity>());
            Service = new CartService(Households, CartRepository, ItemRepository, Clock);
        }

        public MutableClock Clock { get; }

        public TableHouseholdRepository Households { get; }

        public TableCartRepository CartRepository { get; }

        public TableCartItemRepository ItemRepository { get; }

        public CartService Service { get; }

        public Task SeedHouseholdAsync() => Households.AddAsync(
            new HouseholdEntity
            {
                RowKey = HouseholdId,
                Name = "Home",
                OrganizerObjectId = "organizer-1",
                CreatedUtc = Now,
            },
            CancellationToken.None);
    }

    private static async Task<Fixture> SeededAsync()
    {
        var fixture = new Fixture(Now);
        await fixture.SeedHouseholdAsync();
        return fixture;
    }

    [Fact]
    public async Task Get_or_create_creates_a_building_cart_for_the_clocks_week()
    {
        var fixture = await SeededAsync();

        var cart = await fixture.Service.GetOrCreateBuildingCartAsync(HouseholdId, null, CancellationToken.None);

        Assert.NotNull(cart);
        Assert.Equal(CurrentWeek, cart!.WeekIso);
        Assert.Equal(CartStatus.Building, cart.Status);
        Assert.Null(cart.ConfirmedByPersonId);
        Assert.Null(cart.ConfirmedUtc);
        Assert.Empty(cart.Items);
        // The read hands back the persisted version stamp, not an empty one.
        Assert.NotEqual(string.Empty, cart.ETag);
    }

    [Fact]
    public async Task A_second_get_or_create_returns_the_same_cart()
    {
        var fixture = await SeededAsync();

        var first = await fixture.Service.GetOrCreateBuildingCartAsync(HouseholdId, null, CancellationToken.None);
        var second = await fixture.Service.GetOrCreateBuildingCartAsync(HouseholdId, null, CancellationToken.None);

        Assert.Equal(first!.WeekIso, second!.WeekIso);
        Assert.Equal(CartStatus.Building, second.Status);
        // Same single row for the week: the second call created nothing, so the
        // version stamp is unchanged.
        Assert.Equal(first.ETag, second.ETag);
    }

    [Fact]
    public async Task The_week_follows_the_injected_clock()
    {
        var fixture = await SeededAsync();
        await fixture.Service.GetOrCreateBuildingCartAsync(HouseholdId, null, CancellationToken.None);

        // Move the clock into the next ISO week; the cart follows it.
        fixture.Clock.Set(Now.AddDays(7));
        var nextWeek = await fixture.Service.GetOrCreateBuildingCartAsync(HouseholdId, null, CancellationToken.None);

        Assert.Equal(WeekIso.For(Now.AddDays(7)), nextWeek!.WeekIso);
        Assert.NotEqual(CurrentWeek, nextWeek.WeekIso);
    }

    [Fact]
    public async Task A_supplied_week_wins_over_the_clock()
    {
        var fixture = await SeededAsync();

        var cart = await fixture.Service.GetOrCreateBuildingCartAsync(
            HouseholdId, "2026-W40", CancellationToken.None);

        Assert.Equal("2026-W40", cart!.WeekIso);
    }

    [Fact]
    public async Task A_malformed_supplied_week_is_a_validation_failure()
    {
        var fixture = await SeededAsync();

        await Assert.ThrowsAsync<ValidationException>(
            () => fixture.Service.GetOrCreateBuildingCartAsync(HouseholdId, "not-a-week", CancellationToken.None));
    }

    [Fact]
    public async Task A_confirmed_week_is_never_returned_as_the_building_cart()
    {
        var fixture = await SeededAsync();
        await fixture.Service.GetOrCreateBuildingCartAsync(HouseholdId, null, CancellationToken.None);

        // Simulate the G4 confirm on the week's single row.
        var stored = await fixture.CartRepository.GetAsync(HouseholdId, CurrentWeek, CancellationToken.None);
        stored!.Status = CartStatus.Confirmed;
        stored.ConfirmedByPersonId = "organizer-1";
        stored.ConfirmedUtc = Now;
        await fixture.CartRepository.UpdateAsync(
            HouseholdId, stored, stored.ETag.ToString(), CancellationToken.None);

        await Assert.ThrowsAsync<CartAlreadyConfirmedException>(
            () => fixture.Service.GetOrCreateBuildingCartAsync(HouseholdId, null, CancellationToken.None));

        // The confirmed cart stays readable - it is just not "the building cart".
        var read = await fixture.Service.GetCartAsync(HouseholdId, CurrentWeek, CancellationToken.None);
        Assert.True(read.HouseholdExists);
        Assert.Equal(CartStatus.Confirmed, read.Cart!.Status);
        Assert.Equal("organizer-1", read.Cart.ConfirmedByPersonId);
        Assert.Equal(Now, read.Cart.ConfirmedUtc);
    }

    [Fact]
    public async Task An_unknown_household_has_no_cart_to_create()
    {
        var fixture = new Fixture(Now);

        Assert.Null(await fixture.Service.GetOrCreateBuildingCartAsync(
            "no-such-household", null, CancellationToken.None));

        var read = await fixture.Service.GetCartAsync("no-such-household", CurrentWeek, CancellationToken.None);
        Assert.False(read.HouseholdExists);
        Assert.Null(read.Cart);
    }

    [Fact]
    public async Task Reading_a_week_with_no_cart_creates_nothing()
    {
        var fixture = await SeededAsync();

        var read = await fixture.Service.GetCartAsync(HouseholdId, CurrentWeek, CancellationToken.None);

        Assert.True(read.HouseholdExists);
        Assert.Null(read.Cart);
        // The read is side-effect free: no row was minted for the week.
        Assert.Null(await fixture.CartRepository.GetAsync(HouseholdId, CurrentWeek, CancellationToken.None));
    }

    [Fact]
    public async Task The_cart_and_its_items_come_back_in_one_shape()
    {
        var fixture = await SeededAsync();
        await fixture.Service.GetOrCreateBuildingCartAsync(HouseholdId, null, CancellationToken.None);

        await fixture.ItemRepository.AddAsync(
            HouseholdId,
            new CartItemEntity
            {
                RowKey = CartItemEntity.RowKeyFor(CurrentWeek, "item-1"),
                CartWeekIso = CurrentWeek,
                ItemId = "item-1",
                ProductId = "heb-oat-milk",
                DisplayName = "Oat Milk",
                Quantity = 2,
                AddedByPersonId = "person-7",
                SourceConnector = "simulated-heb",
            },
            CancellationToken.None);

        // An item filed under a different week must not leak into this cart.
        await fixture.ItemRepository.AddAsync(
            HouseholdId,
            new CartItemEntity
            {
                RowKey = CartItemEntity.RowKeyFor("2026-W30", "item-2"),
                CartWeekIso = "2026-W30",
                ItemId = "item-2",
                ProductId = "heb-eggs",
                DisplayName = "Eggs",
                Quantity = 1,
                AddedByPersonId = "person-7",
                SourceConnector = "simulated-heb",
            },
            CancellationToken.None);

        var read = await fixture.Service.GetCartAsync(HouseholdId, CurrentWeek, CancellationToken.None);

        var item = Assert.Single(read.Cart!.Items);
        Assert.Equal("item-1", item.ItemId);
        Assert.Equal("heb-oat-milk", item.ProductId);
        Assert.Equal("Oat Milk", item.DisplayName);
        Assert.Equal(2, item.Quantity);
        Assert.Equal("person-7", item.AddedByPersonId);
        Assert.Equal("simulated-heb", item.SourceConnector);
    }

    [Fact]
    public async Task A_malformed_week_on_the_read_is_a_validation_failure()
    {
        var fixture = await SeededAsync();

        await Assert.ThrowsAsync<ValidationException>(
            () => fixture.Service.GetCartAsync(HouseholdId, "2026-W99", CancellationToken.None));
    }

    [Fact]
    public void Constructor_rejects_a_missing_dependency()
    {
        var households = new TableHouseholdRepository(new InMemoryEntityRepository<HouseholdEntity>());
        var carts = new TableCartRepository(new InMemoryEntityRepository<CartEntity>());
        var items = new TableCartItemRepository(new InMemoryEntityRepository<CartItemEntity>());
        var clock = new MutableClock(Now);

        Assert.Throws<ArgumentNullException>(() => new CartService(null!, carts, items, clock));
        Assert.Throws<ArgumentNullException>(() => new CartService(households, null!, items, clock));
        Assert.Throws<ArgumentNullException>(() => new CartService(households, carts, null!, clock));
        Assert.Throws<ArgumentNullException>(() => new CartService(households, carts, items, null!));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task A_blank_household_is_rejected(string? householdId)
    {
        var fixture = new Fixture(Now);

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => fixture.Service.GetOrCreateBuildingCartAsync(householdId!, null, CancellationToken.None));
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => fixture.Service.GetCartAsync(householdId!, CurrentWeek, CancellationToken.None));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task A_blank_week_on_the_read_is_rejected(string? weekIso)
    {
        var fixture = new Fixture(Now);

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => fixture.Service.GetCartAsync(HouseholdId, weekIso!, CancellationToken.None));
    }
}
