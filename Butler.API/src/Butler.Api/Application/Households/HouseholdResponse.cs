namespace Butler.Api.Application.Households;

/// <summary>
/// The household as returned to callers. Carries the server-generated
/// <see cref="HouseholdId"/> and the current <see cref="ETag"/> so a later
/// mutation can supply it as <c>If-Match</c> (Engineering Contract 7.3).
/// </summary>
/// <param name="HouseholdId">The household's id (also its partition key).</param>
/// <param name="Name">The household's display name.</param>
/// <param name="OrganizerObjectId">Object id of the owning organizer.</param>
/// <param name="CreatedUtc">When the household was created.</param>
/// <param name="ETag">The current optimistic-concurrency version stamp.</param>
public sealed record HouseholdResponse(
    string HouseholdId,
    string Name,
    string OrganizerObjectId,
    DateTimeOffset CreatedUtc,
    string ETag);
