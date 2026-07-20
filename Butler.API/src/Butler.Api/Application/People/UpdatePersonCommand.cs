using MediatR;

namespace Butler.Api.Application.People;

/// <summary>
/// Updates a person's display name, role, child flag, and claim colour under
/// optimistic concurrency. Resolves to <c>null</c> when the person does not exist
/// (mapped to <c>404</c>); the <c>If-Match</c> precondition is enforced by the
/// persistence seam (a missing value is <c>428</c>, a stale one <c>412</c>), and
/// demoting the last organizer is rejected with a <c>400</c>.
/// </summary>
/// <param name="HouseholdId">The household the person belongs to.</param>
/// <param name="PersonId">The person id to update.</param>
/// <param name="DisplayName">The new display name.</param>
/// <param name="Role">The new role (<c>Organizer</c> or <c>Participant</c>).</param>
/// <param name="IsChild">The new child flag.</param>
/// <param name="ClaimColor">The new claim colour; optional.</param>
/// <param name="IfMatch">The caller-supplied <c>If-Match</c> ETag.</param>
public sealed record UpdatePersonCommand(
    string HouseholdId,
    string PersonId,
    string DisplayName,
    string Role,
    bool IsChild,
    string? ClaimColor,
    string? IfMatch) : IRequest<PersonResponse?>;

/// <summary>Handles <see cref="UpdatePersonCommand"/> via the application service.</summary>
public sealed class UpdatePersonCommandHandler : IRequestHandler<UpdatePersonCommand, PersonResponse?>
{
    private readonly IPersonService _people;

    public UpdatePersonCommandHandler(IPersonService people)
    {
        ArgumentNullException.ThrowIfNull(people);
        _people = people;
    }

    public Task<PersonResponse?> Handle(UpdatePersonCommand request, CancellationToken cancellationToken) =>
        _people.UpdateAsync(
            request.HouseholdId,
            request.PersonId,
            request.DisplayName,
            request.Role,
            request.IsChild,
            request.ClaimColor,
            request.IfMatch,
            cancellationToken);
}
