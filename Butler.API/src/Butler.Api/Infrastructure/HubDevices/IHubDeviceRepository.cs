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
    /// Replaces an existing device row in the household's partition under
    /// optimistic concurrency and never inserts. Throws
    /// <see cref="Butler.Api.Application.Concurrency.PreconditionFailedException"/>
    /// when the row no longer exists or <paramref name="ifMatch"/> is stale;
    /// <see cref="Butler.Api.Application.Concurrency.OptimisticConcurrency.Wildcard"/>
    /// matches any existing version.
    /// </summary>
    Task UpdateAsync(string householdId, HubDeviceEntity device, string ifMatch, CancellationToken cancellationToken = default);
}
