using MediatR;

namespace Butler.Api.Application.Fairness;

/// <summary>
/// Reads the household's contribution balance over a trailing ISO-week window
/// (C6). The result is <c>null</c> when no household matches
/// <paramref name="HouseholdId"/>, which the controller maps to a <c>404</c>.
/// </summary>
/// <param name="HouseholdId">The household whose balance to read.</param>
/// <param name="WindowWeeks">The number of trailing ISO weeks to aggregate (must be at least 1).</param>
public sealed record GetFairnessQuery(
    string HouseholdId,
    int WindowWeeks) : IRequest<FairnessResponse?>;

/// <summary>Handles <see cref="GetFairnessQuery"/> via the application service.</summary>
public sealed class GetFairnessQueryHandler : IRequestHandler<GetFairnessQuery, FairnessResponse?>
{
    private readonly IFairnessService _fairness;

    public GetFairnessQueryHandler(IFairnessService fairness)
    {
        ArgumentNullException.ThrowIfNull(fairness);
        _fairness = fairness;
    }

    public Task<FairnessResponse?> Handle(GetFairnessQuery request, CancellationToken cancellationToken) =>
        _fairness.GetAsync(request.HouseholdId, request.WindowWeeks, cancellationToken);
}
