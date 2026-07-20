using MediatR;

namespace Butler.Api.Application.People;

/// <summary>
/// Lists the people in a household so tap-to-claim (Epic 30) can later render
/// names. Readable by any authenticated caller, not organizer-gated.
/// </summary>
/// <param name="HouseholdId">The household whose people to list.</param>
public sealed record ListPeopleQuery(string HouseholdId) : IRequest<IReadOnlyList<PersonResponse>>;

/// <summary>Handles <see cref="ListPeopleQuery"/> via the application service.</summary>
public sealed class ListPeopleQueryHandler : IRequestHandler<ListPeopleQuery, IReadOnlyList<PersonResponse>>
{
    private readonly IPersonService _people;

    public ListPeopleQueryHandler(IPersonService people)
    {
        ArgumentNullException.ThrowIfNull(people);
        _people = people;
    }

    public Task<IReadOnlyList<PersonResponse>> Handle(ListPeopleQuery request, CancellationToken cancellationToken) =>
        _people.ListAsync(request.HouseholdId, cancellationToken);
}
