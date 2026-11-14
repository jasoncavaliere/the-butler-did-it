using MediatR;

namespace Butler.Api.Application.Carts;

/// <summary>
/// Adds a shopper-typed custom line - one the store catalog could not match - to
/// a week's building cart. The line carries no product id and no price, so it is
/// counted (not totalled) on the cart read, and it rides along into the confirmed
/// cart like any other line.
/// </summary>
/// <param name="HouseholdId">The household whose cart to add to.</param>
/// <param name="WeekIso">The ISO year-week of the cart (for example <c>2026-W29</c>).</param>
/// <param name="DisplayName">The custom item's name as typed; a blank one is a <c>400</c>.</param>
/// <param name="Quantity">How many to add, or <c>null</c> for one.</param>
/// <param name="PersonId">
/// The acting person, resolved by the controller from the participant session or
/// the request body.
/// </param>
public sealed record AddCustomCartItemCommand(
    string HouseholdId,
    string WeekIso,
    string? DisplayName,
    int? Quantity,
    string PersonId) : IRequest<CartItemView?>;

/// <summary>Handles <see cref="AddCustomCartItemCommand"/> via the cart service.</summary>
public sealed class AddCustomCartItemCommandHandler : IRequestHandler<AddCustomCartItemCommand, CartItemView?>
{
    private readonly ICartService _carts;

    public AddCustomCartItemCommandHandler(ICartService carts)
    {
        ArgumentNullException.ThrowIfNull(carts);
        _carts = carts;
    }

    public Task<CartItemView?> Handle(AddCustomCartItemCommand request, CancellationToken cancellationToken) =>
        _carts.AddCustomItemAsync(
            request.HouseholdId,
            request.WeekIso,
            request.DisplayName,
            request.Quantity,
            request.PersonId,
            cancellationToken);
}
