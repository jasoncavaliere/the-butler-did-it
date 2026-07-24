using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.People;

namespace Butler.Api.Application.Carts;

/// <summary>
/// Default <see cref="ICartConfirmationService"/> - the G4 confirm transition. It
/// reads the week's cart through the existing G2 read, flips the single
/// <c>Carts</c> row to <see cref="CartStatus.Confirmed"/> under the cart's
/// optimistic-concurrency precondition (Engineering Contract 7.3), and stamps who
/// confirmed it and when.
/// </summary>
/// <remarks>
/// <para>
/// The step order carries the behaviour. The cart is read first, so an unknown
/// household and a week with no cart are reported as the absences they are rather
/// than as a failed write. An already-confirmed cart returns <b>before</b> any
/// write and therefore before the precondition is consulted: that is what makes a
/// replayed confirm - same request, same pre-confirm <c>If-Match</c> - an
/// idempotent success instead of a <c>412</c>, while a confirm racing a cart that
/// grew a line still fails the precondition and must re-read.
/// </para>
/// <para>
/// There is deliberately nothing else here. No store connector, no HTTP client, no
/// payment seam: per BRD decision D-8 confirming records intent only, so the whole
/// operation is one row write inside the household partition. Adding an external
/// call to this path would break the D-8 boundary that keeps tap-to-claim safe
/// (risk R-1), and the test suite scans this feature's IL to make sure nobody
/// does.
/// </para>
/// </remarks>
public sealed class CartConfirmationService : ICartConfirmationService
{
    private readonly ICartService _carts;
    private readonly ICartRepository _cartRows;
    private readonly IPersonRepository _people;
    private readonly TimeProvider _clock;

    public CartConfirmationService(
        ICartService carts,
        ICartRepository cartRows,
        IPersonRepository people,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(carts);
        ArgumentNullException.ThrowIfNull(cartRows);
        ArgumentNullException.ThrowIfNull(people);
        ArgumentNullException.ThrowIfNull(clock);
        _carts = carts;
        _cartRows = cartRows;
        _people = people;
        _clock = clock;
    }

    /// <inheritdoc />
    public async Task<CartReadResult> ConfirmAsync(
        string householdId,
        string weekIso,
        string organizerObjectId,
        string? ifMatch,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(weekIso);
        ArgumentException.ThrowIfNullOrWhiteSpace(organizerObjectId);

        // The G2 read validates the week (a malformed one is a 400) and tells the
        // two absences apart: no such household, and no cart for that week.
        var current = await _carts.GetCartAsync(householdId, weekIso, cancellationToken).ConfigureAwait(false);
        if (current.Cart is null)
        {
            return current;
        }

        // Idempotent: an already-confirmed cart is a no-op success. Nothing is
        // written, so who/when keep their original values and the caller's
        // If-Match - stale by definition after the first confirm - is not consulted.
        if (string.Equals(current.Cart.Status, CartStatus.Confirmed, StringComparison.Ordinal))
        {
            return current;
        }

        var confirmedByPersonId = await ResolveOrganizerPersonIdAsync(
            householdId, organizerObjectId, cancellationToken).ConfigureAwait(false);

        await _cartRows
            .UpdateAsync(
                householdId,
                new CartEntity
                {
                    PartitionKey = householdId,
                    RowKey = current.Cart.WeekIso,
                    Status = CartStatus.Confirmed,
                    ConfirmedByPersonId = confirmedByPersonId,
                    // From the injected clock seam, never DateTime.UtcNow (7.5).
                    ConfirmedUtc = _clock.GetUtcNow(),
                },
                ifMatch,
                cancellationToken)
            .ConfigureAwait(false);

        // Re-read so the response carries the persisted version stamp and the
        // stored who/when rather than the locally assembled row.
        return await _carts.GetCartAsync(householdId, weekIso, cancellationToken).ConfigureAwait(false);
    }

    // Which household person the confirm is attributed to. Engineering Contract
    // 7.4: the organizer's object id maps to a People row with role Organizer -
    // H1 seeds exactly that row when the household is created, so the mapping
    // normally hits. Ordering makes the pick deterministic if a household ever
    // carries more than one row bound to the same organizer.
    private async Task<string> ResolveOrganizerPersonIdAsync(
        string householdId,
        string organizerObjectId,
        CancellationToken cancellationToken)
    {
        var roster = await _people.ListAsync(householdId, cancellationToken).ConfigureAwait(false);

        var bound = roster
            .Where(person => string.Equals(person.OrganizerObjectId, organizerObjectId, StringComparison.Ordinal))
            .OrderBy(person => person.RowKey, StringComparer.Ordinal)
            .FirstOrDefault();

        // No roster row is bound to this organizer (a household whose organizer
        // binding was never seeded). Record the authenticated object id itself
        // rather than attributing the confirm to somebody else's person row: who
        // confirmed stays honest and traceable either way.
        return bound?.RowKey ?? organizerObjectId;
    }
}
