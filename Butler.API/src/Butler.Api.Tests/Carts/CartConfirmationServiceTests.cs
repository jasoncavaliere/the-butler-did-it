using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Carts;
using Butler.Api.Application.Concurrency;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.People;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Carts;

/// <summary>
/// Criteria (G4) at the seam, where the branches an HTTP test cannot reach cheaply
/// live: who the confirm is attributed to (the organizer's <c>People</c> row, per
/// Engineering Contract 7.4), the optimistic-concurrency preconditions the
/// transition inherits from 7.3, and the guarantee that an already-confirmed cart
/// is left completely alone.
/// </summary>
public sealed class CartConfirmationServiceTests
{
    // A Wednesday: ISO week 2026-W29 (Monday 2026-07-13 .. Sunday 2026-07-19).
    private static readonly DateTimeOffset Now = new(2026, 7, 15, 8, 0, 0, TimeSpan.Zero);
    private const string CurrentWeek = "2026-W29";
    private const string HouseholdId = "house-1";
    private const string OrganizerObjectId = "organizer-object-1";

    private sealed class Fixture
    {
        public Fixture()
        {
            Clock = new MutableClock(Now);
            Households = new TableHouseholdRepository(new InMemoryEntityRepository<HouseholdEntity>());
            Carts = new TableCartRepository(new InMemoryEntityRepository<CartEntity>());
            Items = new TableCartItemRepository(new InMemoryEntityRepository<CartItemEntity>());
            People = new TablePersonRepository(new InMemoryEntityRepository<PersonEntity>());
            CartService = new CartService(Households, Carts, Items, Clock);
            Service = new CartConfirmationService(CartService, Carts, People, Clock);
        }

        public MutableClock Clock { get; }

        public TableHouseholdRepository Households { get; }

        public TableCartRepository Carts { get; }

        public TableCartItemRepository Items { get; }

        public TablePersonRepository People { get; }

        public CartService CartService { get; }

        public CartConfirmationService Service { get; }

        public Task SeedHouseholdAsync() => Households.AddAsync(
            new HouseholdEntity
            {
                RowKey = HouseholdId,
                Name = "Home",
                OrganizerObjectId = OrganizerObjectId,
                CreatedUtc = Now,
            },
            CancellationToken.None);

        public Task SeedOrganizerPersonAsync(string personId, string? organizerObjectId = OrganizerObjectId) =>
            People.AddAsync(
                HouseholdId,
                new PersonEntity
                {
                    RowKey = personId,
                    DisplayName = "Alex",
                    Role = OrganizerAuthorization.OrganizerRole,
                    OrganizerObjectId = organizerObjectId,
                },
                CancellationToken.None);

        // The building cart the organizer would have reviewed, plus its ETag.
        public async Task<string> SeedBuildingCartAsync()
        {
            var cart = await CartService.GetOrCreateBuildingCartAsync(
                HouseholdId, CurrentWeek, CancellationToken.None);
            return cart!.ETag;
        }
    }

    private static async Task<Fixture> SeededAsync(string? organizerPersonId = "person-organizer")
    {
        var fixture = new Fixture();
        await fixture.SeedHouseholdAsync();
        if (organizerPersonId is not null)
        {
            await fixture.SeedOrganizerPersonAsync(organizerPersonId);
        }

        return fixture;
    }

    [Fact]
    public async Task Confirm_attributes_the_cart_to_the_organizers_person_row()
    {
        var fixture = await SeededAsync();
        var etag = await fixture.SeedBuildingCartAsync();

        var result = await fixture.Service.ConfirmAsync(
            HouseholdId, CurrentWeek, OrganizerObjectId, etag, CancellationToken.None);

        Assert.True(result.HouseholdExists);
        Assert.Equal(CartStatus.Confirmed, result.Cart!.Status);
        Assert.Equal("person-organizer", result.Cart.ConfirmedByPersonId);
        Assert.Equal(Now, result.Cart.ConfirmedUtc);
    }

    [Fact]
    public async Task Confirm_picks_the_organizers_row_over_other_household_people()
    {
        var fixture = await SeededAsync(organizerPersonId: null);
        // A participant (no organizer binding) and two rows bound to the confirming
        // organizer: the pick is deterministic by personId, never the participant.
        await fixture.SeedOrganizerPersonAsync("person-kid", organizerObjectId: null);
        await fixture.SeedOrganizerPersonAsync("person-b");
        await fixture.SeedOrganizerPersonAsync("person-a");
        var etag = await fixture.SeedBuildingCartAsync();

        var result = await fixture.Service.ConfirmAsync(
            HouseholdId, CurrentWeek, OrganizerObjectId, etag, CancellationToken.None);

        Assert.Equal("person-a", result.Cart!.ConfirmedByPersonId);
    }

    [Fact]
    public async Task Confirm_records_the_organizers_object_id_when_no_roster_row_is_bound_to_them()
    {
        // A household whose organizer binding was never seeded on the roster: the
        // confirm still records who did it, using the authenticated object id
        // rather than attributing it to somebody else's person row.
        var fixture = await SeededAsync(organizerPersonId: null);
        var etag = await fixture.SeedBuildingCartAsync();

        var result = await fixture.Service.ConfirmAsync(
            HouseholdId, CurrentWeek, OrganizerObjectId, etag, CancellationToken.None);

        Assert.Equal(OrganizerObjectId, result.Cart!.ConfirmedByPersonId);
    }

    [Fact]
    public async Task Confirming_an_already_confirmed_cart_writes_nothing()
    {
        var fixture = await SeededAsync();
        var etag = await fixture.SeedBuildingCartAsync();
        var first = await fixture.Service.ConfirmAsync(
            HouseholdId, CurrentWeek, OrganizerObjectId, etag, CancellationToken.None);

        // A different organizer, a later clock, and no precondition at all: none of
        // it matters, because an already-confirmed cart is not written to. The
        // missing If-Match would be a 428 if it were.
        fixture.Clock.Set(Now.AddHours(6));
        var second = await fixture.Service.ConfirmAsync(
            HouseholdId, CurrentWeek, "another-organizer", ifMatch: null, CancellationToken.None);

        Assert.Equal(first.Cart!.ConfirmedByPersonId, second.Cart!.ConfirmedByPersonId);
        Assert.Equal(first.Cart.ConfirmedUtc, second.Cart.ConfirmedUtc);
        Assert.Equal(first.Cart.ETag, second.Cart.ETag);
    }

    [Fact]
    public async Task An_unknown_household_confirms_nothing()
    {
        var fixture = await SeededAsync();

        var result = await fixture.Service.ConfirmAsync(
            "no-such-house", CurrentWeek, OrganizerObjectId, "*", CancellationToken.None);

        Assert.False(result.HouseholdExists);
        Assert.Null(result.Cart);
    }

    [Fact]
    public async Task A_week_with_no_cart_confirms_nothing()
    {
        var fixture = await SeededAsync();

        var result = await fixture.Service.ConfirmAsync(
            HouseholdId, "2026-W02", OrganizerObjectId, "*", CancellationToken.None);

        Assert.True(result.HouseholdExists);
        Assert.Null(result.Cart);
    }

    [Fact]
    public async Task A_malformed_week_is_a_validation_failure()
    {
        var fixture = await SeededAsync();

        await Assert.ThrowsAsync<ValidationException>(() => fixture.Service.ConfirmAsync(
            HouseholdId, "2026-W99", OrganizerObjectId, "*", CancellationToken.None));
    }

    [Fact]
    public async Task Transitioning_a_cart_requires_the_version_it_reviewed()
    {
        var fixture = await SeededAsync();
        var etag = await fixture.SeedBuildingCartAsync();

        // No precondition: the caller never said which version it meant (428).
        await Assert.ThrowsAsync<PreconditionRequiredException>(() => fixture.Service.ConfirmAsync(
            HouseholdId, CurrentWeek, OrganizerObjectId, ifMatch: null, CancellationToken.None));

        // The cart moved on after the review, so the reviewed version is stale (412).
        var stored = await fixture.Carts.GetAsync(HouseholdId, CurrentWeek, CancellationToken.None);
        await fixture.Carts.UpdateAsync(
            HouseholdId, stored!, stored!.ETag.ToString(), CancellationToken.None);

        await Assert.ThrowsAsync<PreconditionFailedException>(() => fixture.Service.ConfirmAsync(
            HouseholdId, CurrentWeek, OrganizerObjectId, etag, CancellationToken.None));

        // Neither failure left a half-confirmed cart behind.
        var after = await fixture.Carts.GetAsync(HouseholdId, CurrentWeek, CancellationToken.None);
        Assert.Equal(CartStatus.Building, after!.Status);
        Assert.Null(after.ConfirmedByPersonId);
        Assert.Null(after.ConfirmedUtc);
    }

    [Theory]
    [InlineData(null, CurrentWeek, OrganizerObjectId)]
    [InlineData("", CurrentWeek, OrganizerObjectId)]
    [InlineData(" ", CurrentWeek, OrganizerObjectId)]
    [InlineData(HouseholdId, null, OrganizerObjectId)]
    [InlineData(HouseholdId, "", OrganizerObjectId)]
    [InlineData(HouseholdId, " ", OrganizerObjectId)]
    [InlineData(HouseholdId, CurrentWeek, null)]
    [InlineData(HouseholdId, CurrentWeek, "")]
    [InlineData(HouseholdId, CurrentWeek, " ")]
    public async Task Confirm_rejects_a_missing_identifier(
        string? householdId,
        string? weekIso,
        string? organizerObjectId)
    {
        var fixture = await SeededAsync();

        await Assert.ThrowsAnyAsync<ArgumentException>(() => fixture.Service.ConfirmAsync(
            householdId!, weekIso!, organizerObjectId!, "*", CancellationToken.None));
    }

    [Fact]
    public void The_service_requires_every_collaborator()
    {
        var fixture = new Fixture();

        Assert.Throws<ArgumentNullException>(() => new CartConfirmationService(
            null!, fixture.Carts, fixture.People, fixture.Clock));
        Assert.Throws<ArgumentNullException>(() => new CartConfirmationService(
            fixture.CartService, null!, fixture.People, fixture.Clock));
        Assert.Throws<ArgumentNullException>(() => new CartConfirmationService(
            fixture.CartService, fixture.Carts, null!, fixture.Clock));
        Assert.Throws<ArgumentNullException>(() => new CartConfirmationService(
            fixture.CartService, fixture.Carts, fixture.People, null!));
    }

    [Fact]
    public void The_command_handler_requires_its_service()
    {
        Assert.Throws<ArgumentNullException>(() => new ConfirmCartCommandHandler(null!));
    }

    [Fact]
    public async Task The_command_handler_delegates_to_the_service()
    {
        var fixture = await SeededAsync();
        var etag = await fixture.SeedBuildingCartAsync();
        var handler = new ConfirmCartCommandHandler(fixture.Service);

        var result = await handler.Handle(
            new ConfirmCartCommand(HouseholdId, CurrentWeek, OrganizerObjectId, etag),
            CancellationToken.None);

        Assert.Equal(CartStatus.Confirmed, result.Cart!.Status);
        Assert.Equal("person-organizer", result.Cart.ConfirmedByPersonId);
    }
}
