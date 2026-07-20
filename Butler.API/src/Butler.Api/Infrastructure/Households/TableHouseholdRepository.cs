using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Infrastructure.Households;

/// <summary>
/// <see cref="IHouseholdRepository"/> on the shared F3 Table access seam
/// (<see cref="IEntityRepository{TEntity}"/>). It delegates to the generic
/// household-scoped repository, using the <c>householdId</c> as both the partition
/// key and the row key so the household is a single-row partition addressed by its
/// own id (Engineering Contract 7.3).
/// </summary>
public sealed class TableHouseholdRepository : IHouseholdRepository
{
    private readonly IEntityRepository<HouseholdEntity> _households;

    public TableHouseholdRepository(IEntityRepository<HouseholdEntity> households)
    {
        ArgumentNullException.ThrowIfNull(households);
        _households = households;
    }

    /// <inheritdoc />
    public Task AddAsync(HouseholdEntity household, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(household);
        ArgumentException.ThrowIfNullOrWhiteSpace(household.RowKey);

        // PartitionKey = RowKey = householdId. The generic seam stamps the
        // partition key from the household id argument.
        return _households.AddAsync(household.RowKey, household, cancellationToken);
    }

    /// <inheritdoc />
    public Task<HouseholdEntity?> GetAsync(string householdId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        return _households.GetAsync(householdId, householdId, cancellationToken);
    }
}
