namespace Butler.Api.Application.Chores;

/// <summary>
/// Application service for the Chores feature. Orchestrates the CRUD +
/// deactivation use cases over the chore persistence seam so the MediatR handlers
/// stay thin (Engineering Contract 7.2). Every operation is scoped to one
/// household. A chore references a <c>Room</c> (H2) in the same household, so
/// create and update reject a <c>RoomId</c> that does not resolve; a non-positive
/// <c>Effort</c> is likewise a client error.
/// </summary>
public interface IChoreService
{
    /// <summary>
    /// Creates a chore in the household with a server-generated <c>choreId</c>,
    /// defaulting <c>Active</c> to <c>true</c>. Throws a validation error (mapped
    /// to <c>400</c>, persisting no row) when <paramref name="roomId"/> does not
    /// reference an existing room in the household, when <paramref name="effort"/>
    /// is non-positive, or when <paramref name="cadence"/> is not a known value.
    /// </summary>
    /// <returns>The created chore, including its id and current <c>ETag</c>.</returns>
    Task<ChoreResponse> CreateAsync(
        string householdId,
        string title,
        string roomId,
        string cadence,
        int effort,
        int? minAge,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Lists the household's chores ordered deterministically by <c>choreId</c>,
    /// optionally filtered to only active or only inactive chores when
    /// <paramref name="active"/> is supplied.
    /// </summary>
    Task<IReadOnlyList<ChoreResponse>> ListAsync(
        string householdId,
        bool? active = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the chore with the given id in the household (carrying its current
    /// <c>ETag</c>), or <c>null</c> when no such chore exists.
    /// </summary>
    Task<ChoreResponse?> GetAsync(string householdId, string choreId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Updates a chore's fields under optimistic concurrency. Returns <c>null</c>
    /// when the chore does not exist (the controller maps that to a <c>404</c>);
    /// otherwise applies the change with <paramref name="ifMatch"/> as the
    /// precondition (a missing value is <c>428</c>, a stale one <c>412</c>) and
    /// returns the updated chore with its fresh <c>ETag</c>. Validates the room
    /// reference, effort, and cadence exactly as create does.
    /// </summary>
    Task<ChoreResponse?> UpdateAsync(
        string householdId,
        string choreId,
        string title,
        string roomId,
        string cadence,
        int effort,
        int? minAge,
        bool active,
        string? ifMatch,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Deactivates a chore (sets <c>Active = false</c>), retaining the row rather
    /// than deleting it so Epic 40 assignment/completion history stays referential.
    /// Returns <c>null</c> when the chore does not exist (mapped to <c>404</c>);
    /// otherwise returns the updated chore. Reactivation is via <c>Update</c> with
    /// <c>active = true</c>.
    /// </summary>
    Task<ChoreResponse?> DeactivateAsync(string householdId, string choreId, CancellationToken cancellationToken = default);
}
