using MediatR;

namespace Butler.Api.Application.Rooms;

/// <summary>
/// Lists the rooms in a household, ordered by <c>SortOrder</c> ascending.
/// </summary>
/// <param name="HouseholdId">The household whose rooms to list.</param>
public sealed record ListRoomsQuery(string HouseholdId) : IRequest<IReadOnlyList<RoomResponse>>;

/// <summary>Handles <see cref="ListRoomsQuery"/> via the application service.</summary>
public sealed class ListRoomsQueryHandler : IRequestHandler<ListRoomsQuery, IReadOnlyList<RoomResponse>>
{
    private readonly IRoomService _rooms;

    public ListRoomsQueryHandler(IRoomService rooms)
    {
        ArgumentNullException.ThrowIfNull(rooms);
        _rooms = rooms;
    }

    public Task<IReadOnlyList<RoomResponse>> Handle(ListRoomsQuery request, CancellationToken cancellationToken) =>
        _rooms.ListAsync(request.HouseholdId, cancellationToken);
}
