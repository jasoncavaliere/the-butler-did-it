namespace Butler.Api.Application.Rooms;

/// <summary>
/// A room as returned to callers. Carries the server-generated
/// <see cref="RoomId"/> and the current <see cref="ETag"/> so a later mutation can
/// supply it as <c>If-Match</c> (Engineering Contract 7.3).
/// </summary>
/// <param name="RoomId">The room's id (its row key within the household partition).</param>
/// <param name="Name">The room's display name.</param>
/// <param name="SortOrder">The room's position in the hub-board ordering.</param>
/// <param name="ETag">The current optimistic-concurrency version stamp.</param>
public sealed record RoomResponse(
    string RoomId,
    string Name,
    int SortOrder,
    string ETag);
