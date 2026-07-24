using MediatR;

namespace Butler.Api.Application.Carts;

/// <summary>
/// Gets - creating it if the week has none - the household's <c>Building</c> cart
/// for the target week (G2's get-or-create). Resolves to <c>null</c> when the
/// household does not exist, which the controller maps to a <c>404</c>.
/// </summary>
/// <param name="HouseholdId">The household whose cart to read.</param>
/// <param name="WeekIso">
/// The target ISO year-week, or <c>null</c>/blank to use the injected clock's
/// current week.
/// </param>
public sealed record GetCurrentCartQuery(string HouseholdId, string? WeekIso) : IRequest<CartResponse?>;

/// <summary>Handles <see cref="GetCurrentCartQuery"/> via the application service.</summary>
public sealed class GetCurrentCartQueryHandler : IRequestHandler<GetCurrentCartQuery, CartResponse?>
{
    private readonly ICartService _carts;

    public GetCurrentCartQueryHandler(ICartService carts)
    {
        ArgumentNullException.ThrowIfNull(carts);
        _carts = carts;
    }

    public Task<CartResponse?> Handle(GetCurrentCartQuery request, CancellationToken cancellationToken) =>
        _carts.GetOrCreateBuildingCartAsync(request.HouseholdId, request.WeekIso, cancellationToken);
}
