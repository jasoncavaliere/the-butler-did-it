using MediatR;

namespace Butler.Api.Application.People;

/// <summary>
/// Creates a person in a household with a server-generated <c>personId</c>.
/// </summary>
/// <param name="HouseholdId">The household the person belongs to.</param>
/// <param name="DisplayName">The person's display name.</param>
/// <param name="Role">The person's role (<c>Organizer</c> or <c>Participant</c>).</param>
/// <param name="IsChild">Whether the person is a child.</param>
/// <param name="ClaimColor">The colour a claimed tile glows in; optional.</param>
public sealed record CreatePersonCommand(
    string HouseholdId,
    string DisplayName,
    string Role,
    bool IsChild,
    string? ClaimColor) : IRequest<PersonResponse>;

/// <summary>Handles <see cref="CreatePersonCommand"/> via the application service.</summary>
public sealed class CreatePersonCommandHandler : IRequestHandler<CreatePersonCommand, PersonResponse>
{
    private readonly IPersonService _people;

    public CreatePersonCommandHandler(IPersonService people)
    {
        ArgumentNullException.ThrowIfNull(people);
        _people = people;
    }

    public Task<PersonResponse> Handle(CreatePersonCommand request, CancellationToken cancellationToken) =>
        _people.CreateAsync(
            request.HouseholdId,
            request.DisplayName,
            request.Role,
            request.IsChild,
            request.ClaimColor,
            cancellationToken);
}
