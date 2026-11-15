using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Application.Households;

/// <summary>
/// Default <see cref="IHouseholdTeardownService"/>. It holds no table list: it
/// runs every <see cref="IHouseholdPartitionPurger"/> that
/// <see cref="StorageServiceCollectionExtensions.AddTableRepository{TEntity}"/>
/// registered, so a new table is wiped with no change here. It sweeps every other
/// table first, so a teardown that fails part way leaves the household readable
/// and the organizer can retry. It then deletes the household's own row and
/// sweeps every other table again, so a row written into an already-purged table
/// while the first sweep ran is deleted too (#223). Known limits: a write that
/// authenticated before the household row was deleted but commits after the
/// second sweep can still leave an orphan row, and a failure in the second sweep
/// cannot be retried through teardown because the household is already gone.
/// </summary>
public sealed class HouseholdTeardownService : IHouseholdTeardownService
{
    private readonly IHouseholdRepository _households;
    private readonly IHouseholdPartitionPurger[] _partitionPurgers;
    private readonly IHouseholdPartitionPurger[] _householdPurgers;

    public HouseholdTeardownService(
        IHouseholdRepository households,
        IEnumerable<IHouseholdPartitionPurger> purgers)
    {
        ArgumentNullException.ThrowIfNull(households);
        ArgumentNullException.ThrowIfNull(purgers);
        _households = households;

        // The household row is the only one named, and only to order it between
        // the two sweeps of every other table (kept in registration order).
        var all = purgers.ToArray();
        _partitionPurgers = all.Where(purger => purger.EntityType != typeof(HouseholdEntity)).ToArray();
        _householdPurgers = all.Where(purger => purger.EntityType == typeof(HouseholdEntity)).ToArray();
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

        // Sweep 1 runs while the household still exists. Once its row is gone,
        // participant sessions and hub-device tokens stop authenticating, so
        // sweep 2 catches what landed in an already-purged table meanwhile.
        await PurgeAllAsync(_partitionPurgers, householdId, cancellationToken).ConfigureAwait(false);
        await PurgeAllAsync(_householdPurgers, householdId, cancellationToken).ConfigureAwait(false);
        await PurgeAllAsync(_partitionPurgers, householdId, cancellationToken).ConfigureAwait(false);

        return HouseholdTeardownResult.Deleted;
    }

    private static async Task PurgeAllAsync(
        IHouseholdPartitionPurger[] purgers,
        string householdId,
        CancellationToken cancellationToken)
    {
        foreach (var purger in purgers)
        {
            await purger.PurgeAsync(householdId, cancellationToken).ConfigureAwait(false);
        }
    }
}
