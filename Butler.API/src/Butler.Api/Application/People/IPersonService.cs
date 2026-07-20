namespace Butler.Api.Application.People;

/// <summary>
/// Application service for the People feature. Orchestrates the organizer-managed
/// roster CRUD over the person persistence seam so the MediatR handlers stay thin
/// (Engineering Contract 7.2). Every operation is scoped to one household, and the
/// last-organizer guard is enforced here so a household is never left without an
/// owner.
/// </summary>
public interface IPersonService
{
    /// <summary>
    /// Creates a person in the household with a server-generated <c>personId</c>,
    /// storing their display name, role, child flag, and claim colour.
    /// </summary>
    /// <returns>The created person, including their id and current <c>ETag</c>.</returns>
    Task<PersonResponse> CreateAsync(
        string householdId,
        string displayName,
        string role,
        bool isChild,
        string? claimColor,
        CancellationToken cancellationToken = default);

    /// <summary>Lists the household's people, ordered deterministically by <c>personId</c>.</summary>
    Task<IReadOnlyList<PersonResponse>> ListAsync(string householdId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the person with the given id in the household (carrying their
    /// current <c>ETag</c>), or <c>null</c> when no such person exists.
    /// </summary>
    Task<PersonResponse?> GetAsync(string householdId, string personId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Updates a person's display name, role, child flag, and claim colour under
    /// optimistic concurrency. Returns <c>null</c> when the person does not exist
    /// (the controller maps that to a <c>404</c>); otherwise applies the change
    /// with <paramref name="ifMatch"/> as the precondition (a missing value is
    /// <c>428</c>, a stale one <c>412</c>) and returns the updated person with
    /// their fresh <c>ETag</c>. Throws <see cref="LastOrganizerException"/> when
    /// the change would demote the household's last remaining organizer.
    /// </summary>
    Task<PersonResponse?> UpdateAsync(
        string householdId,
        string personId,
        string displayName,
        string role,
        bool isChild,
        string? claimColor,
        string? ifMatch,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes a person from the household. Returns <c>false</c> when the person
    /// does not exist (the controller maps that to a <c>404</c>); otherwise removes
    /// them and returns <c>true</c>. Throws <see cref="LastOrganizerException"/>
    /// when the deletion would remove the household's last remaining organizer.
    /// </summary>
    Task<bool> DeleteAsync(string householdId, string personId, CancellationToken cancellationToken = default);
}
