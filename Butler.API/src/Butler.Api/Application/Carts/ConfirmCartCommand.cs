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

/// <summary>Handles <see cref="ConfirmCartCommand"/> via the application service.</summary>
public sealed class ConfirmCartCommandHandler : IRequestHandler<ConfirmCartCommand, CartReadResult>
{
    private readonly ICartConfirmationService _confirmations;

    public ConfirmCartCommandHandler(ICartConfirmationService confirmations)
    {
        ArgumentNullException.ThrowIfNull(confirmations);
        _confirmations = confirmations;
    }

    public Task<CartReadResult> Handle(ConfirmCartCommand request, CancellationToken cancellationToken) =>
        _confirmations.ConfirmAsync(
            request.HouseholdId,
            request.WeekIso,
            request.OrganizerObjectId,
            request.IfMatch,
            cancellationToken);
}
