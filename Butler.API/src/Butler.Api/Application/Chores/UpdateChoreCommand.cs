using MediatR;

namespace Butler.Api.Application.Chores;

/// <summary>
/// Updates a chore's fields under optimistic concurrency. Resolves to <c>null</c>
/// when the chore does not exist (mapped to <c>404</c>); the <c>If-Match</c>
/// precondition is enforced by the persistence seam (a missing value is
/// <c>428</c>, a stale one <c>412</c>). Setting <see cref="Active"/> back to
/// <c>true</c> reactivates a previously deactivated chore.
/// </summary>
/// <param name="HouseholdId">The household the chore belongs to.</param>
/// <param name="ChoreId">The chore id to update.</param>
/// <param name="Title">The new display title.</param>
/// <param name="RoomId">The id of the room the chore attaches to (same household).</param>
/// <param name="Cadence">How often the chore recurs: <c>Daily</c> or <c>Weekly</c>.</param>
/// <param name="Effort">The relative effort weight (positive).</param>
/// <param name="MinAge">The minimum age to be assigned the chore; optional.</param>
/// <param name="Active">Whether the chore is active.</param>
/// <param name="IfMatch">The caller-supplied <c>If-Match</c> ETag.</param>
public sealed record UpdateChoreCommand(
    string HouseholdId,
    string ChoreId,
    string Title,
    string RoomId,
    string Cadence,
    int Effort,
    int? MinAge,
    bool Active,
    string? IfMatch) : IRequest<ChoreResponse?>;

/// <summary>Handles <see cref="UpdateChoreCommand"/> via the application service.</summary>
public sealed class UpdateChoreCommandHandler : IRequestHandler<UpdateChoreCommand, ChoreResponse?>
{
    private readonly IChoreService _chores;

    public UpdateChoreCommandHandler(IChoreService chores)
    {
        ArgumentNullException.ThrowIfNull(chores);
        _chores = chores;
    }

    public Task<ChoreResponse?> Handle(UpdateChoreCommand request, CancellationToken cancellationToken) =>
        _chores.UpdateAsync(
            request.HouseholdId,
            request.ChoreId,
            request.Title,
            request.RoomId,
            request.Cadence,
            request.Effort,
            request.MinAge,
            request.Active,
            request.IfMatch,
            cancellationToken);
}
