using MediatR;

namespace Butler.Api.Application.People;

/// <summary>
/// Deletes a person from a household. Resolves to <c>false</c> when the person
/// does not exist (mapped to <c>404</c>); otherwise removes them and resolves to
/// <c>true</c>. Deleting the last organizer is rejected with a <c>400</c>.
/// </summary>
/// <param name="HouseholdId">The household the person belongs to.</param>
/// <param name="PersonId">The person id to delete.</param>
public sealed record DeletePersonCommand(string HouseholdId, string PersonId) : IRequest<bool>;

/// <summary>Handles <see cref="DeletePersonCommand"/> via the application service.</summary>
public sealed class DeletePersonCommandHandler : IRequestHandler<DeletePersonCommand, bool>
{
    private readonly IPersonService _people;

    public DeletePersonCommandHandler(IPersonService people)
    {
        ArgumentNullException.ThrowIfNull(people);
        _people = people;
    }

    public Task<bool> Handle(DeletePersonCommand request, CancellationToken cancellationToken) =>
        _people.DeleteAsync(request.HouseholdId, request.PersonId, cancellationToken);
}
