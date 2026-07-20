namespace Butler.Api.Infrastructure.Households;

/// <summary>
/// Persistence seam for the household aggregate (Engineering Contract 7.3), built
/// on the shared F3 Table access layer. The household is a single-row partition
/// addressed by its own <c>householdId</c>; there is no cross-household query.
/// </summary>
public interface IHouseholdRepository
{
    /// <summary>
    /// Adds a new <c>Households</c> row. The entity's <c>RowKey</c> must already be
    /// the server-generated <c>householdId</c>; the partition key is set to the
    /// same value before writing.
    /// </summary>
    Task AddAsync(HouseholdEntity household, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the household with the given <c>householdId</c> (carrying its current
    /// <c>ETag</c>), or <c>null</c> when no such household exists.
    /// </summary>
    Task<HouseholdEntity?> GetAsync(string householdId, CancellationToken cancellationToken = default);
}
