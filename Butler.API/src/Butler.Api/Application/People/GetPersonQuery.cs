using MediatR;

namespace Butler.Api.Application.People;

/// <summary>
/// Reads a single person by their id within a household. Resolves to <c>null</c>
/// when the person does not exist; the controller maps that to a <c>404</c>
/// problem details.
/// </summary>
/// <param name="HouseholdId">The household the person belongs to.</param>
/// <param name="PersonId">The person id to read.</param>
public sealed record GetPersonQuery(string HouseholdId, string PersonId) : IRequest<PersonResponse?>;

/// <summary>Handles <see cref="GetPersonQuery"/> via the application service.</summary>
public sealed class GetPersonQueryHandler : IRequestHandler<GetPersonQuery, PersonResponse?>
{
    private readonly IPersonService _people;

    public GetPersonQueryHandler(IPersonService people)
    {
        ArgumentNullException.ThrowIfNull(people);
        _people = people;
    }

    public Task<PersonResponse?> Handle(GetPersonQuery request, CancellationToken cancellationToken) =>
        _people.GetAsync(request.HouseholdId, request.PersonId, cancellationToken);
}
