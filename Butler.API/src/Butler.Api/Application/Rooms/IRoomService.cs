namespace Butler.Api.Application.Rooms;

/// <summary>
/// Application service for the Rooms feature. Orchestrates the CRUD use cases over
/// the room persistence seam so the MediatR handlers stay thin (Engineering
/// Contract 7.2). Every operation is scoped to one household.
/// </summary>
public interface IRoomService
{
    /// <summary>
    /// Creates a room in the household with a server-generated <c>roomId</c>,
    /// storing its name and sort order.
    /// </summary>
    /// <returns>The created room, including its id and current <c>ETag</c>.</returns>
    Task<RoomResponse> CreateAsync(
        string householdId,
        string name,
        int sortOrder,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Lists the household's rooms ordered by <c>SortOrder</c> ascending, with a
    /// stable tie-break on <c>roomId</c> so the order is deterministic.
    /// </summary>
    Task<IReadOnlyList<RoomResponse>> ListAsync(string householdId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the room with the given id in the household (carrying its current
    /// <c>ETag</c>), or <c>null</c> when no such room exists.
    /// </summary>
    Task<RoomResponse?> GetAsync(string householdId, string roomId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Updates a room's name and sort order under optimistic concurrency. Returns
    /// <c>null</c> when the room does not exist (the controller maps that to a
    /// <c>404</c>); otherwise applies the change with <paramref name="ifMatch"/>
    /// as the precondition (a missing value is <c>428</c>, a stale one <c>412</c>)
    /// and returns the updated room with its fresh <c>ETag</c>.
    /// </summary>
    Task<RoomResponse?> UpdateAsync(
        string householdId,
        string roomId,
        string name,
        int sortOrder,
        string? ifMatch,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes a room from the household. Returns <c>false</c> when the room does
    /// not exist (the controller maps that to a <c>404</c>); otherwise removes it
    /// and returns <c>true</c>.
    /// </summary>
    Task<bool> DeleteAsync(string householdId, string roomId, CancellationToken cancellationToken = default);
}
