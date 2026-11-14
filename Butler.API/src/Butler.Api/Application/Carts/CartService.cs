using System.ComponentModel.DataAnnotations;
using Butler.Api.Domain.Scheduling;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.Households;

namespace Butler.Api.Application.Carts;

/// <summary>
/// Default <see cref="ICartService"/> - the G2 composition behind the weekly
/// grocery cart. It resolves the target ISO week (supplied, or from the injected
/// <see cref="TimeProvider"/> seam - never <c>DateTime.Now</c>, Engineering
/// Contract 7.5), get-or-creates the week's single <c>Carts</c> row, and joins it
/// with that week's <c>CartItems</c> into one response shape. Everything is
/// scoped to the household partition (7.3), and an unknown household is an absent
/// result rather than an empty cart, so the controller can answer <c>404</c>.
/// </summary>
public sealed class CartService : ICartService
{
    private readonly IHouseholdRepository _households;
    private readonly ICartRepository _carts;
    private readonly ICartItemRepository _items;
    private readonly TimeProvider _clock;

    public CartService(
        IHouseholdRepository households,
        ICartRepository carts,
        ICartItemRepository items,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(households);
        ArgumentNullException.ThrowIfNull(carts);
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(clock);
        _households = households;
        _carts = carts;
        _items = items;
        _clock = clock;
    }

    /// <inheritdoc />
    public async Task<CartResponse?> GetOrCreateBuildingCartAsync(
        string householdId,
        string? weekIso,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        // Unknown household is a 404, not a cart created under a phantom partition.
        var household = await _households.GetAsync(householdId, cancellationToken).ConfigureAwait(false);
        if (household is null)
        {
            return null;
        }

        var targetWeek = ResolveWeek(weekIso);
        var cart = await _carts.GetAsync(householdId, targetWeek, cancellationToken).ConfigureAwait(false);

        if (cart is null)
        {
            await _carts
                .AddAsync(
                    householdId,
                    new CartEntity { RowKey = targetWeek, Status = CartStatus.Building },
                    cancellationToken)
                .ConfigureAwait(false);

            // Re-read so the response ETag is the persisted version rather than
            // whatever the local instance happened to carry after the write.
            cart = await _carts.GetAsync(householdId, targetWeek, cancellationToken).ConfigureAwait(false)
                ?? throw new InvalidOperationException(
                    $"Cart '{targetWeek}' was created but could not be read back in household '{householdId}'.");
        }
        else if (string.Equals(cart.Status, CartStatus.Confirmed, StringComparison.Ordinal))
        {
            // The week has exactly one cart row, and it is already confirmed (G4).
            // A confirmed cart is never handed back as the building cart.
            throw new CartAlreadyConfirmedException(
                $"The cart for week '{targetWeek}' in household '{householdId}' has already been confirmed.");
        }

        return await ComposeAsync(householdId, cart, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<CartReadResult> GetCartAsync(
        string householdId,
        string weekIso,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(weekIso);

        var household = await _households.GetAsync(householdId, cancellationToken).ConfigureAwait(false);
        if (household is null)
        {
            return new CartReadResult(HouseholdExists: false, Cart: null);
        }

        var targetWeek = ValidateWeek(weekIso);
        var cart = await _carts.GetAsync(householdId, targetWeek, cancellationToken).ConfigureAwait(false);
        if (cart is null)
        {
            return new CartReadResult(HouseholdExists: true, Cart: null);
        }

        var composed = await ComposeAsync(householdId, cart, cancellationToken).ConfigureAwait(false);
        return new CartReadResult(HouseholdExists: true, Cart: composed);
    }

    /// <inheritdoc />
    public async Task<CartItemView?> AddCustomItemAsync(
        string householdId,
        string? weekIso,
        string? displayName,
        int? quantity,
        string personId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(personId);

        // Validate the name before touching storage, so a blank add writes
        // nothing at all - not even the week's cart row.
        var name = displayName?.Trim();
        if (string.IsNullOrEmpty(name))
        {
            throw new ValidationException("A custom item needs a display name.");
        }

        var cart = await GetOrCreateBuildingCartAsync(householdId, weekIso, cancellationToken)
            .ConfigureAwait(false);
        if (cart is null)
        {
            return null;
        }

        var count = quantity is int requested && requested > 0 ? requested : 1;

        // The same two-step write as a capture: advance the cart row's version
        // under If-Match first, so a confirm holding the older version is a 412
        // and a lost race leaves no orphan line behind.
        await _carts
            .UpdateAsync(
                householdId,
                new CartEntity
                {
                    PartitionKey = householdId,
                    RowKey = cart.WeekIso,
                    Status = cart.Status,
                    ConfirmedByPersonId = cart.ConfirmedByPersonId,
                    ConfirmedUtc = cart.ConfirmedUtc,
                },
                cart.ETag,
                cancellationToken)
            .ConfigureAwait(false);

        var itemId = Guid.NewGuid().ToString("N");
        await _items
            .AddAsync(
                householdId,
                new CartItemEntity
                {
                    PartitionKey = householdId,
                    RowKey = CartItemEntity.RowKeyFor(cart.WeekIso, itemId),
                    CartWeekIso = cart.WeekIso,
                    ItemId = itemId,
                    ProductId = string.Empty,
                    DisplayName = name,
                    Quantity = count,
                    AddedByPersonId = personId,
                    SourceConnector = CartItemSources.Custom,
                    IndicativePrice = null,
                    IsCustom = true,
                },
                cancellationToken)
            .ConfigureAwait(false);

        return new CartItemView(
            itemId,
            ProductId: null,
            name,
            count,
            personId,
            CartItemSources.Custom,
            IndicativePrice: null,
            IsCustom: true);
    }

    // The cart and its week's items in one shape - the single read the hub renders.
    private async Task<CartResponse> ComposeAsync(
        string householdId,
        CartEntity cart,
        CancellationToken cancellationToken)
    {
        var items = await _items
            .ListForWeekAsync(householdId, cart.RowKey, cancellationToken)
            .ConfigureAwait(false);

        return new CartResponse(
            cart.RowKey,
            cart.Status,
            cart.ConfirmedByPersonId,
            cart.ConfirmedUtc,
            cart.ETag.ToString(),
            items
                .Select(item => new CartItemView(
                    item.ItemId,
                    // A custom line has no catalog product and no price.
                    item.IsCustom ? null : item.ProductId,
                    item.DisplayName,
                    item.Quantity,
                    item.AddedByPersonId,
                    item.SourceConnector,
                    item.IsCustom ? null : item.IndicativePrice,
                    item.IsCustom))
                .ToList());
    }

    // A supplied week is validated; an omitted one comes from the injected clock,
    // so the week a handler buckets on is always deterministic (7.5).
    private string ResolveWeek(string? weekIso) =>
        string.IsNullOrWhiteSpace(weekIso)
            ? WeekIso.For(_clock.GetUtcNow())
            : ValidateWeek(weekIso);

    // Parse to validate the shape; a malformed value is a client error (400), not
    // the 500 a raw FormatException would map to.
    private static string ValidateWeek(string weekIso)
    {
        try
        {
            _ = WeekIso.StartOfWeekUtc(weekIso);
        }
        catch (FormatException ex)
        {
            throw new ValidationException(ex.Message);
        }

        return weekIso;
    }
}
