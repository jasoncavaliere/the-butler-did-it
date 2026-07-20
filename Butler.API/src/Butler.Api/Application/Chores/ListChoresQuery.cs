using MediatR;

namespace Butler.Api.Application.Chores;

/// <summary>
/// Lists the chores in a household, optionally filtered by <c>Active</c> state.
/// </summary>
/// <param name="HouseholdId">The household whose chores to list.</param>
/// <param name="Active">
/// When supplied, restricts the result to chores whose <c>Active</c> flag matches;
/// <c>null</c> returns every chore.
/// </param>
public sealed record ListChoresQuery(string HouseholdId, bool? Active) : IRequest<IReadOnlyList<ChoreResponse>>;

/// <summary>Handles <see cref="ListChoresQuery"/> via the application service.</summary>
public sealed class ListChoresQueryHandler : IRequestHandler<ListChoresQuery, IReadOnlyList<ChoreResponse>>
{
    private readonly IChoreService _chores;

    public ListChoresQueryHandler(IChoreService chores)
    {
        ArgumentNullException.ThrowIfNull(chores);
        _chores = chores;
    }

    public Task<IReadOnlyList<ChoreResponse>> Handle(ListChoresQuery request, CancellationToken cancellationToken) =>
        _chores.ListAsync(request.HouseholdId, request.Active, cancellationToken);
}
