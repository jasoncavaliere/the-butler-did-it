using MediatR;

namespace Butler.Api.Application.Rooms;

/// <summary>
/// Reads a single room by its id within a household. Resolves to <c>null</c> when
/// the room does not exist; the controller maps that to a <c>404</c> problem
/// details.
/// </summary>
/// <param name="HouseholdId">The household the room belongs to.</param>
/// <param name="RoomId">The room id to read.</param>
public sealed record GetRoomQuery(string HouseholdId, string RoomId) : IRequest<RoomResponse?>;

/// <summary>Handles <see cref="GetRoomQuery"/> via the application service.</summary>
public sealed class GetRoomQueryHandler : IRequestHandler<GetRoomQuery, RoomResponse?>
{
    private readonly IRoomService _rooms;

    public GetRoomQueryHandler(IRoomService rooms)
    {
        ArgumentNullException.ThrowIfNull(rooms);
        _rooms = rooms;
    }

    public Task<RoomResponse?> Handle(GetRoomQuery request, CancellationToken cancellationToken) =>
        _rooms.GetAsync(request.HouseholdId, request.RoomId, cancellationToken);
}
