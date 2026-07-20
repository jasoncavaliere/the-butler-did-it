namespace Butler.Api.Infrastructure.People;

/// <summary>
/// Persistence seam for the People feature (Engineering Contract 7.3), built on
/// the shared F3 Table access layer. Every operation is scoped to a single
/// household by <c>PartitionKey = householdId</c>; there is no cross-household
/// query. Mutations flow through the shared optimistic-concurrency rules (a
/// missing <c>If-Match</c> is <c>428</c>, a stale one <c>412</c>).
/// </summary>
public interface IPersonRepository
{
    /// <summary>
    /// Adds a new <c>People</c> row to the household's partition. The entity's
    /// <c>RowKey</c> must already be the server-generated <c>personId</c>.
    /// </summary>
    Task AddAsync(string householdId, PersonEntity person, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the person with the given <c>personId</c> in the household (carrying
    /// its current <c>ETag</c>), or <c>null</c> when no such person exists.
    /// </summary>
    Task<PersonEntity?> GetAsync(string householdId, string personId, CancellationToken cancellationToken = default);

    /// <summary>Returns every person in the household's partition.</summary>
    Task<IReadOnlyList<PersonEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces a person under optimistic concurrency. <paramref name="ifMatch"/> is
    /// required (<c>428</c> when missing) and must match the stored version
    /// (<c>412</c> when stale).
    /// </summary>
    Task UpdateAsync(string householdId, PersonEntity person, string? ifMatch, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes the person with the given <c>personId</c> from the household's
    /// partition. <paramref name="ifMatch"/> gates the delete under optimistic
    /// concurrency (a stale value is <c>412</c>).
    /// </summary>
    Task DeleteAsync(string householdId, string personId, string? ifMatch, CancellationToken cancellationToken = default);
}
