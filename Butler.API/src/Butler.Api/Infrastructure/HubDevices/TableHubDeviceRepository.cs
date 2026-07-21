using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Infrastructure.HubDevices;

/// <summary>
/// <see cref="IHubDeviceRepository"/> on the shared F3 Table access seam
/// (<see cref="IEntityRepository{TEntity}"/>). It delegates to the generic
/// household-scoped repository, so every operation is keyed by
/// <c>PartitionKey = householdId</c> and a device is addressed by its
/// <c>deviceId</c> within that partition (Engineering Contract 7.3).
/// </summary>
public sealed class TableHubDeviceRepository : IHubDeviceRepository
{
    private readonly IEntityRepository<HubDeviceEntity> _devices;

    public TableHubDeviceRepository(IEntityRepository<HubDeviceEntity> devices)
    {
        ArgumentNullException.ThrowIfNull(devices);
        _devices = devices;
    }

    /// <inheritdoc />
    public Task AddAsync(string householdId, HubDeviceEntity device, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(device);
        ArgumentException.ThrowIfNullOrWhiteSpace(device.RowKey);
        return _devices.AddAsync(householdId, device, cancellationToken);
    }

    /// <inheritdoc />
    public Task<HubDeviceEntity?> GetAsync(string householdId, string deviceId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);
        return _devices.GetAsync(householdId, deviceId, cancellationToken);
    }

    /// <inheritdoc />
    public Task UpsertAsync(string householdId, HubDeviceEntity device, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(device);
        ArgumentException.ThrowIfNullOrWhiteSpace(device.RowKey);
        return _devices.UpsertAsync(householdId, device, cancellationToken);
    }
}
