using MediatR;

namespace Butler.Api.Application.Rooms;

/// <summary>
/// Deletes a room from a household. Resolves to <c>false</c> when the room does
/// not exist (mapped to <c>404</c>); otherwise removes it and resolves to
/// <c>true</c>.
/// </summary>
/// <param name="HouseholdId">The household the room belongs to.</param>
/// <param name="RoomId">The room id to delete.</param>
public sealed record DeleteRoomCommand(string HouseholdId, string RoomId) : IRequest<bool>;

/// <summary>Handles <see cref="DeleteRoomCommand"/> via the application service.</summary>
public sealed class DeleteRoomCommandHandler : IRequestHandler<DeleteRoomCommand, bool>
{
    private readonly IRoomService _rooms;

    public DeleteRoomCommandHandler(IRoomService rooms)
    {
        ArgumentNullException.ThrowIfNull(rooms);
        _rooms = rooms;
    }

    public Task<bool> Handle(DeleteRoomCommand request, CancellationToken cancellationToken) =>
        _rooms.DeleteAsync(request.HouseholdId, request.RoomId, cancellationToken);
}
