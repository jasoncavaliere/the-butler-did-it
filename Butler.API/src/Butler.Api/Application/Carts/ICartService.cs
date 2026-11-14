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

    /// <summary>
    /// Adds a shopper-typed custom line (one that matched no catalog product) to
    /// the week's <c>Building</c> cart, creating the cart on first use exactly as
    /// <see cref="GetOrCreateBuildingCartAsync"/> does. The line has no product id
    /// and no price. A missing or non-positive quantity is one. Resolves to
    /// <c>null</c> when the household does not exist.
    /// </summary>
    /// <param name="householdId">The household whose cart to add to.</param>
    /// <param name="weekIso">The target ISO year-week, or <c>null</c> for the current week.</param>
    /// <param name="displayName">The custom item's name as the shopper typed it.</param>
    /// <param name="quantity">How many to add, or <c>null</c> for one.</param>
    /// <param name="personId">The person the line is attributed to.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <exception cref="System.ComponentModel.DataAnnotations.ValidationException">
    /// <paramref name="displayName"/> is blank (checked before any storage access,
    /// so nothing is written), or <paramref name="weekIso"/> is malformed (a <c>400</c>).
    /// </exception>
    /// <exception cref="CartAlreadyConfirmedException">
    /// The week's cart is already <c>Confirmed</c> (a <c>409</c>).
    /// </exception>
    Task<CartItemView?> AddCustomItemAsync(
        string householdId,
        string? weekIso,
        string? displayName,
        int? quantity,
        string personId,
        CancellationToken cancellationToken = default);
}
