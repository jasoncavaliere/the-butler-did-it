using MediatR;

namespace Butler.Api.Application.Chores;

/// <summary>
/// Creates a chore in a household with a server-generated <c>choreId</c>,
/// attached to a room in the same household.
/// </summary>
/// <param name="HouseholdId">The household the chore belongs to.</param>
/// <param name="Title">The chore's display title.</param>
/// <param name="RoomId">The id of the room the chore attaches to (same household).</param>
/// <param name="Cadence">How often the chore recurs: <c>Daily</c> or <c>Weekly</c>.</param>
/// <param name="Effort">The relative effort weight (positive).</param>
/// <param name="MinAge">The minimum age to be assigned the chore; optional.</param>
public sealed record CreateChoreCommand(
    string HouseholdId,
    string Title,
    string RoomId,
    string Cadence,
    int Effort,
    int? MinAge) : IRequest<ChoreResponse>;

/// <summary>Handles <see cref="CreateChoreCommand"/> via the application service.</summary>
public sealed class CreateChoreCommandHandler : IRequestHandler<CreateChoreCommand, ChoreResponse>
{
    private readonly IChoreService _chores;

    public CreateChoreCommandHandler(IChoreService chores)
    {
        ArgumentNullException.ThrowIfNull(chores);
        _chores = chores;
    }

    public Task<ChoreResponse> Handle(CreateChoreCommand request, CancellationToken cancellationToken) =>
        _chores.CreateAsync(
            request.HouseholdId,
            request.Title,
            request.RoomId,
            request.Cadence,
            request.Effort,
            request.MinAge,
            cancellationToken);
}
