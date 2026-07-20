using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Infrastructure.Rooms;

/// <summary>
/// <see cref="IRoomRepository"/> on the shared F3 Table access seam
/// (<see cref="IEntityRepository{TEntity}"/>). It delegates to the generic
/// household-scoped repository, so every operation is keyed by
/// <c>PartitionKey = householdId</c> and a room is addressed by its
/// <c>roomId</c> within that partition (Engineering Contract 7.3).
/// </summary>
public sealed class TableRoomRepository : IRoomRepository
{
    private readonly IEntityRepository<RoomEntity> _rooms;

    public TableRoomRepository(IEntityRepository<RoomEntity> rooms)
    {
        ArgumentNullException.ThrowIfNull(rooms);
        _rooms = rooms;
    }

    /// <inheritdoc />
    public Task AddAsync(string householdId, RoomEntity room, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(room);
        ArgumentException.ThrowIfNullOrWhiteSpace(room.RowKey);
        return _rooms.AddAsync(householdId, room, cancellationToken);
    }

    /// <inheritdoc />
    public Task<RoomEntity?> GetAsync(string householdId, string roomId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(roomId);
        return _rooms.GetAsync(householdId, roomId, cancellationToken);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<RoomEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        return _rooms.ListAsync(householdId, cancellationToken);
    }

    /// <inheritdoc />
    public Task UpdateAsync(string householdId, RoomEntity room, string? ifMatch, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(room);
        ArgumentException.ThrowIfNullOrWhiteSpace(room.RowKey);
        return _rooms.UpdateAsync(householdId, room, ifMatch, cancellationToken);
    }

    /// <inheritdoc />
    public Task DeleteAsync(string householdId, string roomId, string? ifMatch, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(roomId);
        return _rooms.DeleteAsync(householdId, roomId, ifMatch, cancellationToken);
    }
}
