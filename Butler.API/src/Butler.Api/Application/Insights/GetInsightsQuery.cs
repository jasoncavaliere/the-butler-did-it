using MediatR;

namespace Butler.Api.Application.Insights;

/// <summary>
/// Reads the organizer's insights over a trailing ISO-week window (#123). The
/// result is <c>null</c> when no household matches <paramref name="HouseholdId"/>,
/// which the controller maps to a <c>404</c>.
/// </summary>
/// <param name="HouseholdId">The household whose insights to read.</param>
/// <param name="Weeks">The number of trailing ISO weeks (1 to <see cref="InsightsService.MaxWeeks"/>); <c>null</c> when missing.</param>
public sealed record GetInsightsQuery(
    string HouseholdId,
    int? Weeks) : IRequest<InsightsResponse?>;

/// <summary>Handles <see cref="GetInsightsQuery"/> via the application service.</summary>
public sealed class GetInsightsQueryHandler : IRequestHandler<GetInsightsQuery, InsightsResponse?>
{
    private readonly IInsightsService _insights;

    public GetInsightsQueryHandler(IInsightsService insights)
    {
        ArgumentNullException.ThrowIfNull(insights);
        _insights = insights;
    }

    public Task<InsightsResponse?> Handle(GetInsightsQuery request, CancellationToken cancellationToken) =>
        _insights.GetAsync(request.HouseholdId, request.Weeks, cancellationToken);
}
