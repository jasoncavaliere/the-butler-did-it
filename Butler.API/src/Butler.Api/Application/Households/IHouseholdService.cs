namespace Butler.Api.Application.Households;

/// <summary>
/// Application service for the household aggregate. Orchestrates the create/read
/// use cases across the household and people persistence seams so the MediatR
/// handlers stay thin (Engineering Contract 7.2).
/// </summary>
public interface IHouseholdService
{
    /// <summary>
    /// Creates a household with a server-generated id and, in the same operation,
    /// the owning organizer's <c>People</c> row (<c>Role = Organizer</c>,
    /// <c>IsChild = false</c>) so the roster is never left without an owner.
    /// </summary>
    /// <param name="name">The household's display name.</param>
    /// <param name="organizerObjectId">Object id of the creating organizer.</param>
    /// <param name="organizerDisplayName">
    /// Display name to seed the organizer's roster row with; falls back to a
    /// default when the caller has no name claim.
    /// </param>
    /// <returns>The created household, including its id and current <c>ETag</c>.</returns>
    Task<HouseholdResponse> CreateAsync(
        string name,
        string organizerObjectId,
        string? organizerDisplayName,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the household with the given id (carrying its current <c>ETag</c>),
    /// or <c>null</c> when no such household exists.
    /// </summary>
    Task<HouseholdResponse?> GetAsync(string householdId, CancellationToken cancellationToken = default);
}
