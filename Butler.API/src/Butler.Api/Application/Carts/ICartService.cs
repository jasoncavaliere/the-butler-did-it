namespace Butler.Api.Application.Carts;

/// <summary>
/// The cart read/compose surface (G2). It owns the get-or-create rule for a
/// week's building cart and the single response shape that returns a cart with
/// its items. The week is never read from the ambient clock inside a handler:
/// it is either supplied by the caller or computed from the injected
/// <see cref="TimeProvider"/> seam (Engineering Contract 7.5).
/// </summary>
public interface ICartService
{
    /// <summary>
    /// Returns the household's <c>Building</c> cart for the target week, creating
    /// it when the week has no cart yet. The week comes from
    /// <paramref name="weekIso"/> when supplied, otherwise from the injected
    /// clock. Resolves to <c>null</c> when the household does not exist (the
    /// controller maps that to a <c>404</c>).
    /// </summary>
    /// <exception cref="System.ComponentModel.DataAnnotations.ValidationException">
    /// <paramref name="weekIso"/> was supplied but is not a well-formed ISO
    /// year-week (a <c>400</c>).
    /// </exception>
    /// <exception cref="CartAlreadyConfirmedException">
    /// The week's cart exists but is already <c>Confirmed</c>, so there is no
    /// building cart to hand back (a <c>409</c>).
    /// </exception>
    Task<CartResponse?> GetOrCreateBuildingCartAsync(
        string householdId,
        string? weekIso,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Reads one week's cart with its items. Creates nothing: a week with no cart
    /// reads back as an absent cart, distinct from an unknown household.
    /// </summary>
    /// <exception cref="System.ComponentModel.DataAnnotations.ValidationException">
    /// <paramref name="weekIso"/> is not a well-formed ISO year-week (a <c>400</c>).
    /// </exception>
    Task<CartReadResult> GetCartAsync(
        string householdId,
        string weekIso,
        CancellationToken cancellationToken = default);
}
