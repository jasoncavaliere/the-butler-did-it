using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Application.Households;

/// <summary>
/// Default <see cref="IHouseholdTeardownService"/>. It holds no table list: it
/// runs every <see cref="IHouseholdPartitionPurger"/> that
/// <see cref="StorageServiceCollectionExtensions.AddTableRepository{TEntity}"/>
/// registered, so a new table is wiped with no change here. The household's own
/// row goes last, so a teardown that fails part way leaves the household
/// readable and the organizer can retry.
/// </summary>
public sealed class HouseholdTeardownService : IHouseholdTeardownService
{
    private readonly IHouseholdRepository _households;
    private readonly IReadOnlyList<IHouseholdPartitionPurger> _purgers;

    public HouseholdTeardownService(
        IHouseholdRepository households,
        IEnumerable<IHouseholdPartitionPurger> purgers)
    {
        ArgumentNullException.ThrowIfNull(households);
        ArgumentNullException.ThrowIfNull(purgers);
        _households = households;

        // The household row is the only one named, and only to order it last.
        _purgers = purgers
            .OrderBy(purger => purger.EntityType == typeof(HouseholdEntity))
            .ToArray();
    }

    /// <inheritdoc />
    public async Task<HouseholdTeardownResult> TeardownAsync(
        string householdId,
        string confirmName,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        var household = await _households.GetAsync(householdId, cancellationToken).ConfigureAwait(false);
        if (household is null)
        {
            return HouseholdTeardownResult.NotFound;
        }

        // Exact match only: no trimming, no case folding.
        if (!string.Equals(confirmName, household.Name, StringComparison.Ordinal))
        {
            return HouseholdTeardownResult.NameMismatch;
        }

        foreach (var purger in _purgers)
        {
            await purger.PurgeAsync(householdId, cancellationToken).ConfigureAwait(false);
        }

        return HouseholdTeardownResult.Deleted;
    }
}
