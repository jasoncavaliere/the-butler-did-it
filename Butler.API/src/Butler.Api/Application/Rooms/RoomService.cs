using Butler.Api.Application.Concurrency;
using Butler.Api.Infrastructure.Rooms;

namespace Butler.Api.Application.Rooms;

/// <summary>
/// Default <see cref="IRoomService"/>. Rooms are a straightforward
/// household-scoped CRUD table: create stamps a server-generated id; list applies
/// the deterministic <c>SortOrder</c> ordering; update and delete pre-check
/// existence so an unknown room is a <c>404</c> rather than a concurrency error,
/// and update flows through the shared F3 optimistic-concurrency helper before
/// re-reading so the returned <c>ETag</c> is the persisted one.
/// </summary>
public sealed class RoomService : IRoomService
{
    private readonly IRoomRepository _rooms;

    public RoomService(IRoomRepository rooms)
    {
        ArgumentNullException.ThrowIfNull(rooms);
        _rooms = rooms;
    }

    /// <inheritdoc />
    public async Task<RoomResponse> CreateAsync(
        string householdId,
        string name,
        int sortOrder,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);

        var roomId = NewId();
        var room = new RoomEntity
        {
            PartitionKey = householdId,
            RowKey = roomId,
            Name = name,
            SortOrder = sortOrder,
        };

        await _rooms.AddAsync(householdId, room, cancellationToken).ConfigureAwait(false);

        // Re-read so the response ETag is the persisted version, not whatever the
        // in-memory or Table write happened to leave on the local instance.
        var created = await _rooms.GetAsync(householdId, roomId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException(
                $"Room '{roomId}' was created but could not be read back.");

        return Map(created);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<RoomResponse>> ListAsync(
        string householdId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        var rooms = await _rooms.ListAsync(householdId, cancellationToken).ConfigureAwait(false);

        // Ascending by SortOrder; tie-break on roomId so equal orders stay stable
        // regardless of the backing store's natural iteration order.
        return rooms
            .OrderBy(room => room.SortOrder)
            .ThenBy(room => room.RowKey, StringComparer.Ordinal)
            .Select(Map)
            .ToList();
    }

    /// <inheritdoc />
    public async Task<RoomResponse?> GetAsync(
        string householdId,
        string roomId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(roomId);

        var room = await _rooms.GetAsync(householdId, roomId, cancellationToken).ConfigureAwait(false);
        return room is null ? null : Map(room);
    }

    /// <inheritdoc />
    public async Task<RoomResponse?> UpdateAsync(
        string householdId,
        string roomId,
        string name,
        int sortOrder,
        string? ifMatch,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(roomId);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);

        // Existence pre-check so an unknown room is a 404, not a 412/428 from the
        // concurrency layer. A known room then enforces the If-Match precondition.
        var existing = await _rooms.GetAsync(householdId, roomId, cancellationToken).ConfigureAwait(false);
        if (existing is null)
        {
            return null;
        }

        existing.Name = name;
        existing.SortOrder = sortOrder;
        await _rooms.UpdateAsync(householdId, existing, ifMatch, cancellationToken).ConfigureAwait(false);

        // Re-read so the returned ETag is the persisted post-update version.
        var updated = await _rooms.GetAsync(householdId, roomId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException(
                $"Room '{roomId}' was updated but could not be read back.");

        return Map(updated);
    }

    /// <inheritdoc />
    public async Task<bool> DeleteAsync(
        string householdId,
        string roomId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(roomId);

        var existing = await _rooms.GetAsync(householdId, roomId, cancellationToken).ConfigureAwait(false);
        if (existing is null)
        {
            return false;
        }

        // Delete is not concurrency-gated (Contract 7.3 scopes If-Match to
        // updates); the wildcard removes the current version unconditionally.
        await _rooms
            .DeleteAsync(householdId, roomId, OptimisticConcurrency.Wildcard, cancellationToken)
            .ConfigureAwait(false);
        return true;
    }

    private static RoomResponse Map(RoomEntity entity) => new(
        entity.RowKey,
        entity.Name,
        entity.SortOrder,
        entity.ETag.ToString());

    // Server-generated, opaque, collision-resistant id (Contract 7.3 keys).
    private static string NewId() => Guid.NewGuid().ToString("N");
}
