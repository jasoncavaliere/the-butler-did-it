using MediatR;

namespace Butler.Api.Application.Chores;

/// <summary>
/// Reads a single chore by its id within a household. Resolves to <c>null</c>
/// when the chore does not exist; the controller maps that to a <c>404</c>
/// problem details.
/// </summary>
/// <param name="HouseholdId">The household the chore belongs to.</param>
/// <param name="ChoreId">The chore id to read.</param>
public sealed record GetChoreQuery(string HouseholdId, string ChoreId) : IRequest<ChoreResponse?>;

/// <summary>Handles <see cref="GetChoreQuery"/> via the application service.</summary>
public sealed class GetChoreQueryHandler : IRequestHandler<GetChoreQuery, ChoreResponse?>
{
    private readonly IChoreService _chores;

    public GetChoreQueryHandler(IChoreService chores)
    {
        ArgumentNullException.ThrowIfNull(chores);
        _chores = chores;
    }

    public Task<ChoreResponse?> Handle(GetChoreQuery request, CancellationToken cancellationToken) =>
        _chores.GetAsync(request.HouseholdId, request.ChoreId, cancellationToken);
}
