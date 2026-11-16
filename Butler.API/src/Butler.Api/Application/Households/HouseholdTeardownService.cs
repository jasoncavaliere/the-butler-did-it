using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.Logging;

namespace Butler.Api.Application.Households;

/// <summary>
/// Default <see cref="IHouseholdTeardownService"/>. It holds no table list: it
/// runs every <see cref="IHouseholdPartitionPurger"/> that
/// <see cref="StorageServiceCollectionExtensions.AddTableRepository{TEntity}"/>
/// registered, so a new table is wiped with no change here. It sweeps every other
/// table first, so a teardown that fails part way leaves the household readable
/// and the organizer can retry. It then deletes the household's own row and
/// sweeps every other table again, so a row written into an already-purged table
/// while the first sweep ran is deleted too (#223). If the household purge or
/// the second sweep throws or is cancelled, it puts the household row back, so a
/// retry finds the household and finishes the purge. A cancellation of the
/// caller's token is then rethrown unchanged, so an aborted request ends as a
/// cancellation rather than an error (#336); any other failure is wrapped in
/// <see cref="HouseholdTeardownIncompleteException"/> (#294). Known limits: a write that
/// authenticated before the household row was deleted but commits after the
/// second sweep can still leave an orphan row, and if restoring the row also
/// fails, the remaining rows are unreachable through teardown. In that case the
/// original failure is logged at Error and the restore failure propagates on its
/// own, so the API answers a generic <c>500</c> problem and both failures are in
/// the logs (#337).
/// </summary>
public sealed partial class HouseholdTeardownService : IHouseholdTeardownService
{
    private readonly IHouseholdRepository _households;
    private readonly IHouseholdPartitionPurger[] _partitionPurgers;
    private readonly IHouseholdPartitionPurger[] _householdPurgers;
    private readonly ILogger<HouseholdTeardownService> _logger;

    public HouseholdTeardownService(
        IHouseholdRepository households,
        IEnumerable<IHouseholdPartitionPurger> purgers,
        ILogger<HouseholdTeardownService> logger)
    {
        ArgumentNullException.ThrowIfNull(households);
        ArgumentNullException.ThrowIfNull(purgers);
        ArgumentNullException.ThrowIfNull(logger);
        _households = households;
        _logger = logger;

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
        try
        {
            await PurgeAllAsync(_householdPurgers, householdId, cancellationToken).ConfigureAwait(false);
            await PurgeAllAsync(_partitionPurgers, householdId, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Covers cancellation too. Without the household row a retry would be
            // a 404 and the rows left behind would be unreachable (#294), so put it
            // back first in every case. A failed restore propagates on its own,
            // so log the original failure first or it would be lost (#337).
            try
            {
                await RestoreHouseholdAsync(householdId, household).ConfigureAwait(false);
            }
            catch
            {
                LogOriginalFailureWhenRestoreFailed(ex, householdId);
                throw;
            }

            // The caller cancelled (an aborted request): rethrow as is, so the host
            // treats it as a client abort (499, no error log), not a failure (#336).
            // Classify by the caller's token, not the exception's: SDK and linked
            // token sources carry other tokens. Any other cancellation, such as an
            // SDK timeout, is a failure and is wrapped like the rest (#294).
            if (ex is OperationCanceledException && cancellationToken.IsCancellationRequested)
            {
                throw;
            }

            throw HouseholdTeardownIncompleteException.ForHousehold(householdId, ex);
        }

        return HouseholdTeardownResult.Deleted;
    }

    // Runs with CancellationToken.None on purpose: the request token may be the
    // very thing that stopped the teardown, and the restore must still land so
    // the household stays reachable for a retry. Only re-adds a missing row:
    // adding over an existing key throws.
    private async Task RestoreHouseholdAsync(string householdId, HouseholdEntity household)
    {
        var current = await _households.GetAsync(householdId, CancellationToken.None).ConfigureAwait(false);
        if (current is null)
        {
            await _households.AddAsync(household, CancellationToken.None).ConfigureAwait(false);
        }
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

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Error,
        Message = "Teardown of household {HouseholdId} failed and restoring its Households row also failed; this is the original failure, the restore failure propagates")]
    private partial void LogOriginalFailureWhenRestoreFailed(Exception exception, string householdId);
}
