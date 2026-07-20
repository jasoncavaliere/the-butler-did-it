namespace Butler.Api.Application.Chores;

/// <summary>
/// A chore as returned to callers. Carries the server-generated
/// <see cref="ChoreId"/> and the current <see cref="ETag"/> so a later mutation
/// can supply it as <c>If-Match</c> (Engineering Contract 7.3). The
/// <see cref="Effort"/>, <see cref="Cadence"/>, and <see cref="MinAge"/> fields
/// are the inputs the Epic 40 fair-assignment engine reads.
/// </summary>
/// <param name="ChoreId">The chore's id (its row key within the household partition).</param>
/// <param name="Title">The chore's display title.</param>
/// <param name="RoomId">The id of the room the chore attaches to (same household).</param>
/// <param name="Cadence">How often the chore recurs: <c>Daily</c> or <c>Weekly</c>.</param>
/// <param name="Effort">The relative effort weight (positive).</param>
/// <param name="MinAge">The minimum age to be assigned the chore; <c>null</c> when unrestricted.</param>
/// <param name="Active">Whether the chore is active (deactivated chores are retained).</param>
/// <param name="ETag">The current optimistic-concurrency version stamp.</param>
public sealed record ChoreResponse(
    string ChoreId,
    string Title,
    string RoomId,
    string Cadence,
    int Effort,
    int? MinAge,
    bool Active,
    string ETag);
