using MediatR;

namespace Butler.Api.Application.Carts;

/// <summary>
/// Reads one week's cart with its items, creating nothing. The result
/// distinguishes an unknown household from a week that simply has no cart yet;
/// the controller maps each to its own <c>404</c> problem details.
/// </summary>
/// <param name="HouseholdId">The household whose cart to read.</param>
/// <param name="WeekIso">The ISO year-week to read (for example <c>2026-W29</c>).</param>
public sealed record GetCartQuery(string HouseholdId, string WeekIso) : IRequest<CartReadResult>;

/// <summary>Handles <see cref="GetCartQuery"/> via the application service.</summary>
public sealed class GetCartQueryHandler : IRequestHandler<GetCartQuery, CartReadResult>
{
    private readonly ICartService _carts;

    public GetCartQueryHandler(ICartService carts)
    {
        ArgumentNullException.ThrowIfNull(carts);
        _carts = carts;
    }

    public Task<CartReadResult> Handle(GetCartQuery request, CancellationToken cancellationToken) =>
        _carts.GetCartAsync(request.HouseholdId, request.WeekIso, cancellationToken);
}
