using Butler.Api.Application.Events;
using MediatR;

namespace Butler.Api.Application.Carts;

/// <summary>
/// Confirms a week's grocery cart on behalf of the authenticated organizer (G4):
/// the cart flips to <c>Confirmed</c> with who/when, and nothing leaves the
/// service - per BRD decision D-8 the confirm records intent only. The result
/// distinguishes an unknown household from a week with no cart to confirm, so the
/// controller maps each to its own <c>404</c>.
/// </summary>
/// <param name="HouseholdId">The household whose cart to confirm.</param>
/// <param name="WeekIso">The ISO year-week of the cart (for example <c>2026-W29</c>).</param>
/// <param name="OrganizerObjectId">
/// The confirming organizer's object id, resolved from the authenticated principal
/// by the controller (Engineering Contract 7.4) and carried on the command so the
/// handler stays free of the HTTP context.
/// </param>
/// <param name="IfMatch">
/// The cart's expected version from the review read, supplied as the
/// <c>If-Match</c> header (a missing value is <c>428</c>, a stale one <c>412</c>).
/// </param>
public sealed record ConfirmCartCommand(
    string HouseholdId,
    string WeekIso,
    string OrganizerObjectId,
    string? IfMatch) : IRequest<CartReadResult>;

/// <summary>
/// Handles <see cref="ConfirmCartCommand"/> via the application service, then
/// records a <c>cart-confirmed</c> usage event (#122) when a cart came back.
/// </summary>
public sealed class ConfirmCartCommandHandler : IRequestHandler<ConfirmCartCommand, CartReadResult>
{
    private readonly ICartConfirmationService _confirmations;
    private readonly IEventRecorder _events;

    public ConfirmCartCommandHandler(ICartConfirmationService confirmations, IEventRecorder events)
    {
        ArgumentNullException.ThrowIfNull(confirmations);
        ArgumentNullException.ThrowIfNull(events);
        _confirmations = confirmations;
        _events = events;
    }

    public async Task<CartReadResult> Handle(ConfirmCartCommand request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var result = await _confirmations.ConfirmAsync(
                request.HouseholdId,
                request.WeekIso,
                request.OrganizerObjectId,
                request.IfMatch,
                cancellationToken)
            .ConfigureAwait(false);
        if (result.Cart is not null)
        {
            await _events.TryRecordAsync(
                    request.HouseholdId,
                    EventTypes.CartConfirmed,
                    personId: result.Cart.ConfirmedByPersonId,
                    weekIso: result.Cart.WeekIso,
                    cancellationToken: cancellationToken)
                .ConfigureAwait(false);
        }

        return result;
    }
}
