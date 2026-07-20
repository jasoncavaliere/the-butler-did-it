using MediatR;

namespace Butler.Api.Application.Households;

/// <summary>
/// Reads a single household by its id. Resolves to <c>null</c> when the household
/// does not exist; the controller maps that to a <c>404</c> problem details.
/// </summary>
/// <param name="HouseholdId">The household id to read.</param>
public sealed record GetHouseholdQuery(string HouseholdId) : IRequest<HouseholdResponse?>;

/// <summary>Handles <see cref="GetHouseholdQuery"/> via the application service.</summary>
public sealed class GetHouseholdQueryHandler : IRequestHandler<GetHouseholdQuery, HouseholdResponse?>
{
    private readonly IHouseholdService _households;

    public GetHouseholdQueryHandler(IHouseholdService households)
    {
        ArgumentNullException.ThrowIfNull(households);
        _households = households;
    }

    public Task<HouseholdResponse?> Handle(GetHouseholdQuery request, CancellationToken cancellationToken) =>
        _households.GetAsync(request.HouseholdId, cancellationToken);
}
