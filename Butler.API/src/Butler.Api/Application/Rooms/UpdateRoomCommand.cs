using MediatR;

namespace Butler.Api.Application.Rooms;

/// <summary>
/// Updates a room's name and sort order under optimistic concurrency. Resolves to
/// <c>null</c> when the room does not exist (mapped to <c>404</c>); the
/// <c>If-Match</c> precondition is enforced by the persistence seam (a missing
/// value is <c>428</c>, a stale one <c>412</c>).
/// </summary>
/// <param name="HouseholdId">The household the room belongs to.</param>
/// <param name="RoomId">The room id to update.</param>
/// <param name="Name">The new display name.</param>
/// <param name="SortOrder">The new hub-board ordering position.</param>
/// <param name="IfMatch">The caller-supplied <c>If-Match</c> ETag.</param>
public sealed record UpdateRoomCommand(
    string HouseholdId,
    string RoomId,
    string Name,
    int SortOrder,
    string? IfMatch) : IRequest<RoomResponse?>;

/// <summary>Handles <see cref="UpdateRoomCommand"/> via the application service.</summary>
public sealed class UpdateRoomCommandHandler : IRequestHandler<UpdateRoomCommand, RoomResponse?>
{
    private readonly IRoomService _rooms;

    public UpdateRoomCommandHandler(IRoomService rooms)
    {
        ArgumentNullException.ThrowIfNull(rooms);
        _rooms = rooms;
    }

    public Task<RoomResponse?> Handle(UpdateRoomCommand request, CancellationToken cancellationToken) =>
        _rooms.UpdateAsync(
            request.HouseholdId,
            request.RoomId,
            request.Name,
            request.SortOrder,
            request.IfMatch,
            cancellationToken);
}
