namespace Butler.Api.Application.Carts;

/// <summary>
/// Raised when the building cart is asked for but the week's cart has already
/// been confirmed (G4). A week is a single <c>Carts</c> row keyed by its
/// <c>weekIso</c>, so get-or-create can never mint a second cart for the week -
/// and it must never hand a <c>Confirmed</c> cart back as if it were still
/// building. Mapped to HTTP <c>409 Conflict</c> by
/// <c>Mediation/ApiExceptionHandler</c>; the confirmed cart itself stays readable
/// through the by-week read.
/// </summary>
public sealed class CartAlreadyConfirmedException : Exception
{
    private const string DefaultMessage =
        "The cart for this week has already been confirmed.";

    public CartAlreadyConfirmedException()
        : base(DefaultMessage)
    {
    }

    public CartAlreadyConfirmedException(string message)
        : base(message)
    {
    }

    public CartAlreadyConfirmedException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
