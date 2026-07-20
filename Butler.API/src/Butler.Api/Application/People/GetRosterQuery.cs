using MediatR;

namespace Butler.Api.Application.People;

/// <summary>
/// Reads the claimable tap-to-claim roster for a household (T1): the people the
/// hub renders as name tiles, projected down to the claimable fields only. This
/// is an open, unauthenticated read - the hub has no login (Decision D-3) - so it
/// never carries organizer-only data.
/// </summary>
/// <param name="HouseholdId">The household whose roster to read.</param>
public sealed record GetRosterQuery(string HouseholdId) : IRequest<IReadOnlyList<RosterEntryResponse>>;

/// <summary>Handles <see cref="GetRosterQuery"/> by projecting the household's people.</summary>
public sealed class GetRosterQueryHandler : IRequestHandler<GetRosterQuery, IReadOnlyList<RosterEntryResponse>>
{
    private readonly IPersonService _people;

    public GetRosterQueryHandler(IPersonService people)
    {
        ArgumentNullException.ThrowIfNull(people);
        _people = people;
    }

    public async Task<IReadOnlyList<RosterEntryResponse>> Handle(
        GetRosterQuery request,
        CancellationToken cancellationToken)
    {
        var people = await _people.ListAsync(request.HouseholdId, cancellationToken).ConfigureAwait(false);

        // Project to the trimmed roster shape: no role, ETag, or organizer binding.
        return people
            .Select(person => new RosterEntryResponse(
                person.PersonId,
                person.DisplayName,
                person.ClaimColor,
                person.IsChild))
            .ToList();
    }
}
