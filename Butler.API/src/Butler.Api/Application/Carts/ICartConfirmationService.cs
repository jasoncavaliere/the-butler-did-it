namespace Butler.Api.Application.Carts;

/// <summary>
/// The cart confirm surface (G4) - "the human on the final tap" from BRD section
/// 6.4. It owns the one lifecycle transition a cart has:
/// <see cref="Infrastructure.Carts.CartStatus.Building"/> to
/// <see cref="Infrastructure.Carts.CartStatus.Confirmed"/>, stamped with who
/// confirmed it and when (from the injected clock seam, Engineering Contract 7.5).
/// </summary>
/// <remarks>
/// <para>
/// Confirming <b>records intent only</b>. Per BRD decision D-8 no real order is
/// placed and no money moves, so this seam deliberately has no store connector,
/// no HTTP client, and no payment dependency - the only side effect it can have is
/// the cart row's own status. That absence is the safety boundary that keeps
/// tap-to-claim safe (risk R-1), which is why it is asserted by test rather than
/// left as a convention.
/// </para>
/// <para>
/// Confirm is a sensitive action, so the endpoint in front of this service carries
/// the <c>Organizer</c> policy (Engineering Contract 7.4): a tap-to-claim
/// participant and the paired hub device can review a cart but never confirm one.
/// </para>
/// </remarks>
public interface ICartConfirmationService
{
    /// <summary>
    /// Confirms the household's cart for <paramref name="weekIso"/> on behalf of
    /// the authenticated organizer.
    /// </summary>
    /// <param name="householdId">The household whose cart to confirm.</param>
    /// <param name="weekIso">The ISO year-week of the cart (for example <c>2026-W29</c>).</param>
    /// <param name="organizerObjectId">
    /// The confirming organizer's object id, resolved from the authenticated
    /// principal. It is mapped to the organizer's <c>People</c> row so the stored
    /// <c>ConfirmedByPersonId</c> is a household person, not a token subject
    /// (Engineering Contract 7.4).
    /// </param>
    /// <param name="ifMatch">
    /// The cart's expected version, from the review read's <c>ETag</c>. Required on
    /// a cart that is actually being transitioned (a missing value is <c>428</c>, a
    /// stale one <c>412</c>); an already-confirmed cart writes nothing, so it never
    /// consults the precondition.
    /// </param>
    /// <param name="cancellationToken">A cancellation token.</param>
    /// <returns>
    /// The confirmed cart with its items, or the absence the controller turns into
    /// a <c>404</c>: an unknown household, or a week with no cart to confirm.
    /// Confirming an already-<c>Confirmed</c> cart is an idempotent no-op success
    /// that returns the cart with its original
    /// <see cref="CartResponse.ConfirmedByPersonId"/> and
    /// <see cref="CartResponse.ConfirmedUtc"/> untouched.
    /// </returns>
    /// <exception cref="System.ComponentModel.DataAnnotations.ValidationException">
    /// <paramref name="weekIso"/> is not a well-formed ISO year-week (a <c>400</c>).
    /// </exception>
    /// <exception cref="Concurrency.PreconditionRequiredException">
    /// A cart needed transitioning but no <c>If-Match</c> was supplied (a <c>428</c>).
    /// </exception>
    /// <exception cref="Concurrency.PreconditionFailedException">
    /// The supplied <c>If-Match</c> no longer matches the stored cart - it grew a
    /// line underneath the reviewer, who must re-read and confirm again (a <c>412</c>).
    /// </exception>
    Task<CartReadResult> ConfirmAsync(
        string householdId,
        string weekIso,
        string organizerObjectId,
        string? ifMatch,
        CancellationToken cancellationToken = default);
}
