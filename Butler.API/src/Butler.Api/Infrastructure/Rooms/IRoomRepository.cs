namespace Butler.Api.Infrastructure.Rooms;

/// <summary>
/// Persistence seam for the Rooms feature (Engineering Contract 7.3), built on the
/// shared F3 Table access layer. Every operation is scoped to a single household
/// by <c>PartitionKey = householdId</c>; there is no cross-household query.
/// Mutations flow through the shared optimistic-concurrency rules (a missing
/// <c>If-Match</c> is <c>428</c>, a stale one <c>412</c>).
/// </summary>
public interface IRoomRepository
{
    /// <summary>
    /// Adds a new <c>Rooms</c> row to the household's partition. The entity's
    /// <c>RowKey</c> must already be the server-generated <c>roomId</c>.
    /// </summary>
    Task AddAsync(string householdId, RoomEntity room, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the room with the given <c>roomId</c> in the household (carrying its
    /// current <c>ETag</c>), or <c>null</c> when no such room exists.
    /// </summary>
    Task<RoomEntity?> GetAsync(string householdId, string roomId, CancellationToken cancellationToken = default);

    /// <summary>Returns every room in the household's partition.</summary>
    Task<IReadOnlyList<RoomEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces a room under optimistic concurrency. <paramref name="ifMatch"/> is
    /// required (<c>428</c> when missing) and must match the stored version
    /// (<c>412</c> when stale).
    /// </summary>
    Task UpdateAsync(string householdId, RoomEntity room, string? ifMatch, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes the room with the given <c>roomId</c> from the household's
    /// partition. <paramref name="ifMatch"/> gates the delete under optimistic
    /// concurrency (a stale value is <c>412</c>).
    /// </summary>
    Task DeleteAsync(string householdId, string roomId, string? ifMatch, CancellationToken cancellationToken = default);
}
