using MediatR;

namespace Butler.Api.Application.Chores;

/// <summary>
/// Deactivates a chore (sets <c>Active = false</c>), retaining the row rather than
/// deleting it so Epic 40 assignment/completion history stays referential.
/// Resolves to <c>null</c> when the chore does not exist (mapped to <c>404</c>);
/// otherwise resolves to the updated chore. Reactivation is via
/// <see cref="UpdateChoreCommand"/> with <c>Active = true</c>.
/// </summary>
/// <param name="HouseholdId">The household the chore belongs to.</param>
/// <param name="ChoreId">The chore id to deactivate.</param>
public sealed record DeactivateChoreCommand(string HouseholdId, string ChoreId) : IRequest<ChoreResponse?>;

/// <summary>Handles <see cref="DeactivateChoreCommand"/> via the application service.</summary>
public sealed class DeactivateChoreCommandHandler : IRequestHandler<DeactivateChoreCommand, ChoreResponse?>
{
    private readonly IChoreService _chores;

    public DeactivateChoreCommandHandler(IChoreService chores)
    {
        ArgumentNullException.ThrowIfNull(chores);
        _chores = chores;
    }

    public Task<ChoreResponse?> Handle(DeactivateChoreCommand request, CancellationToken cancellationToken) =>
        _chores.DeactivateAsync(request.HouseholdId, request.ChoreId, cancellationToken);
}
