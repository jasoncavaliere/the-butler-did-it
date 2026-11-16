using Butler.Api.Application.Households;
using MediatR;

namespace Butler.Api.Application.Rooms;

/// <summary>
/// Creates a room in a household with a server-generated <c>roomId</c>.
/// A household that does not exist is a <c>404</c> before the handler runs
/// (<see cref="IHouseholdWriteRequest"/>, #295).
/// </summary>
/// <param name="HouseholdId">The household the room belongs to.</param>
/// <param name="Name">The room's display name.</param>
/// <param name="SortOrder">The room's position in the hub-board ordering.</param>
public sealed record CreateRoomCommand(
    string HouseholdId,
    string Name,
    int SortOrder) : IRequest<RoomResponse>, IHouseholdWriteRequest;

/// <summary>Handles <see cref="CreateRoomCommand"/> via the application service.</summary>
public sealed class CreateRoomCommandHandler : IRequestHandler<CreateRoomCommand, RoomResponse>
{
    private readonly IRoomService _rooms;

    public CreateRoomCommandHandler(IRoomService rooms)
    {
        ArgumentNullException.ThrowIfNull(rooms);
        _rooms = rooms;
    }

    public Task<RoomResponse> Handle(CreateRoomCommand request, CancellationToken cancellationToken) =>
        _rooms.CreateAsync(request.HouseholdId, request.Name, request.SortOrder, cancellationToken);
}
