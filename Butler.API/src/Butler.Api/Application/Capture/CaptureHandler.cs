using Butler.Api.Application.Carts;
using Butler.Api.Application.Grocery;
using Butler.Api.Infrastructure.Carts;

namespace Butler.Api.Application.Capture;

/// <summary>
/// Default <see cref="ICaptureHandler"/> - the shared resolve-and-add behaviour
/// behind every capture source (G3). It composes three existing seams and adds no
/// storage of its own: <see cref="ICartService"/> for G2's get-or-create building
/// cart, <see cref="IStoreConnector"/> for G1's product resolution, and the cart
/// repositories for the write.
/// </summary>
/// <remarks>
/// <para>
/// Order matters. The term is extracted first, so a meaningless utterance never
/// creates a cart; the household is validated next (through get-or-create), so an
/// unknown household is reported as such rather than as a no-match; only then is
/// the catalog searched.
/// </para>
/// <para>
/// The write is two steps, cart row before line item, both under the household
/// partition (Engineering Contract 7.3). The cart row is advanced with the
/// <c>ETag</c> the get-or-create read handed back, so the cart's contents and its
/// version stamp move together: an organizer's G4 confirm holding the older
/// version is a <c>412</c> and must re-read - it can never confirm a cart that
/// silently grew a line underneath it. Doing the concurrency-checked step first
/// means a lost race leaves no orphan item behind.
/// </para>
/// </remarks>
public sealed class CaptureHandler : ICaptureHandler
{
    /// <summary>How many of a product a capture adds when none is specified.</summary>
    public const int DefaultQuantity = 1;

    private readonly ICartService _carts;
    private readonly ICartRepository _cartRows;
    private readonly ICartItemRepository _items;
    private readonly IStoreConnector _store;

    public CaptureHandler(
        ICartService carts,
        ICartRepository cartRows,
        ICartItemRepository items,
        IStoreConnector store)
    {
        ArgumentNullException.ThrowIfNull(carts);
        ArgumentNullException.ThrowIfNull(cartRows);
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(store);
        _carts = carts;
        _cartRows = cartRows;
        _items = items;
        _store = store;
    }

    /// <inheritdoc />
    public async Task<CaptureResult> ResolveAndAddAsync(
        string captureSource,
        CaptureRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(captureSource);
        ArgumentNullException.ThrowIfNull(request);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.HouseholdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.PersonId);

        // Nothing product-shaped in the utterance: answer before touching storage.
        var term = UtteranceNormalizer.ExtractProductTerm(request.Utterance);
        if (term.Length == 0)
        {
            return CaptureResult.EmptyTerm(captureSource);
        }

        // G2's get-or-create: the week's single Building cart, created on first
        // use. A null result is an unknown household; an already-confirmed week
        // throws CartAlreadyConfirmedException (a 409) from here.
        var cart = await _carts
            .GetOrCreateBuildingCartAsync(request.HouseholdId, request.WeekIso, cancellationToken)
            .ConfigureAwait(false);
        if (cart is null)
        {
            return CaptureResult.HouseholdNotFound(captureSource, term);
        }

        var matches = await _store.SearchProductsAsync(term, cancellationToken).ConfigureAwait(false);
        var product = Resolve(term, matches);
        if (product is null)
        {
            return matches.Count == 0
                ? CaptureResult.NoMatch(captureSource, term, cart.WeekIso)
                : CaptureResult.Ambiguous(captureSource, term, cart.WeekIso, matches);
        }

        var item = await AddItemAsync(request, cart, product, cancellationToken).ConfigureAwait(false);
        return CaptureResult.Added(captureSource, term, cart.WeekIso, item);
    }

    // Which of the connector's matches is "the top match". An exact display-name
    // hit wins outright; failing that, a single match is unambiguous. Several
    // equally plausible matches resolve to nothing, so the caller offers them as
    // suggestions instead of picking one at random.
    private static StoreProduct? Resolve(string term, IReadOnlyList<StoreProduct> matches)
    {
        var exact = matches.FirstOrDefault(
            match => string.Equals(match.DisplayName, term, StringComparison.OrdinalIgnoreCase));
        if (exact is not null)
        {
            return exact;
        }

        return matches.Count == 1 ? matches[0] : null;
    }

    // Writes the line into the week's cart: the cart row's version first (the
    // optimistic-concurrency checkpoint), then the CartItems row.
    private async Task<CartItemView> AddItemAsync(
        CaptureRequest request,
        CartResponse cart,
        StoreProduct product,
        CancellationToken cancellationToken)
    {
        var quantity = request.Quantity is int requested && requested > 0 ? requested : DefaultQuantity;

        // Replace the cart row with itself under If-Match: it changes nothing but
        // the version stamp, which is exactly the point (see the class remarks).
        await _cartRows
            .UpdateAsync(
                request.HouseholdId,
                new CartEntity
                {
                    PartitionKey = request.HouseholdId,
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
                request.HouseholdId,
                new CartItemEntity
                {
                    PartitionKey = request.HouseholdId,
                    RowKey = CartItemEntity.RowKeyFor(cart.WeekIso, itemId),
                    CartWeekIso = cart.WeekIso,
                    ItemId = itemId,
                    ProductId = product.ProductId,
                    DisplayName = product.DisplayName,
                    Quantity = quantity,
                    AddedByPersonId = request.PersonId,
                    // The origin of the line, carried straight off the G1 result so
                    // it survives a connector swap.
                    SourceConnector = product.SourceConnector,
                },
                cancellationToken)
            .ConfigureAwait(false);

        return new CartItemView(
            itemId,
            product.ProductId,
            product.DisplayName,
            quantity,
            request.PersonId,
            product.SourceConnector);
    }
}
