namespace Butler.Api.Infrastructure.HubDevices;

/// <summary>
/// Persistence seam for the HubDevices feature (Engineering Contract 7.3), built
/// on the shared F3 Table access layer. Every operation is scoped to a single
/// household by <c>PartitionKey = householdId</c>; there is no cross-household
/// query. A paired device is addressed by its <c>deviceId</c> within the
/// household partition.
/// </summary>
public interface IHubDeviceRepository
{
    /// <summary>
    /// Adds a newly paired <c>HubDevices</c> row to the household's partition. The
    /// entity's <c>RowKey</c> must already be the server-generated <c>deviceId</c>.
    /// </summary>
    Task AddAsync(string householdId, HubDeviceEntity device, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the device with the given <c>deviceId</c> in the household (carrying
    /// its current <c>ETag</c>), or <c>null</c> when no such device exists.
    /// </summary>
    Task<HubDeviceEntity?> GetAsync(string householdId, string deviceId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Inserts or replaces the device row in the household's partition with no
    /// concurrency check. Used to refresh <c>LastSeenUtc</c> when the device token
    /// is presented, a last-writer-wins touch that must not fail on a race.
    /// </summary>
    Task UpsertAsync(string householdId, HubDeviceEntity device, CancellationToken cancellationToken = default);
}
