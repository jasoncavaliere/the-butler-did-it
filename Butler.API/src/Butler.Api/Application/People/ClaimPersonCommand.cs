using Butler.Api.Application.Auth;
using MediatR;

namespace Butler.Api.Application.People;

/// <summary>
/// Claims a person at the hub (T1): with no password and no organizer JWT, mint a
/// participant session scoped to exactly <c>(householdId, personId)</c>. Resolves
/// to <c>null</c> when the person does not exist in the household (the controller
/// maps that to a <c>404</c>), so an unknown <c>personId</c> or <c>householdId</c>
/// cannot mint a session for a person who is not on the roster.
/// </summary>
/// <param name="HouseholdId">The household the claim is scoped to.</param>
/// <param name="PersonId">The person being claimed.</param>
public sealed record ClaimPersonCommand(string HouseholdId, string PersonId)
    : IRequest<ParticipantSessionResponse?>;

/// <summary>Handles <see cref="ClaimPersonCommand"/>: verifies the person, then issues a session.</summary>
public sealed class ClaimPersonCommandHandler : IRequestHandler<ClaimPersonCommand, ParticipantSessionResponse?>
{
    private readonly IPersonService _people;

    public ClaimPersonCommandHandler(IPersonService people)
    {
        ArgumentNullException.ThrowIfNull(people);
        _people = people;
    }

    public async Task<ParticipantSessionResponse?> Handle(
        ClaimPersonCommand request,
        CancellationToken cancellationToken)
    {
        // Only a person actually on the household roster can be claimed; an unknown
        // person or household resolves to null -> 404.
        var person = await _people
            .GetAsync(request.HouseholdId, request.PersonId, cancellationToken)
            .ConfigureAwait(false);
        if (person is null)
        {
            return null;
        }

        var token = ParticipantSession.Encode(request.HouseholdId, person.PersonId);
        return new ParticipantSessionResponse(
            request.HouseholdId,
            person.PersonId,
            person.DisplayName,
            person.ClaimColor,
            person.IsChild,
            token);
    }
}
