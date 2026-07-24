namespace Butler.Api.Infrastructure.Carts;

/// <summary>
/// The two lifecycle states a <see cref="CartEntity"/> can hold (Engineering
/// Contract 7.3). Stored as a plain string on the Table row; these constants keep
/// the values off magic-string literals across the cart, capture (G3), and
/// confirm (G4) code paths.
/// </summary>
public static class CartStatus
{
    /// <summary>The week's cart is open and still accepting items.</summary>
    public const string Building = "Building";

    /// <summary>
    /// The week's cart has been confirmed by an organizer (G4). A confirmed cart
    /// is never handed back as the building cart.
    /// </summary>
    public const string Confirmed = "Confirmed";
}
