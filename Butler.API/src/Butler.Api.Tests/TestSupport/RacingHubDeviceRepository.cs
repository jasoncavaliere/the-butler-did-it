using Butler.Api.Application.Concurrency;
using Butler.Api.Infrastructure.HubDevices;
using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Tests.TestSupport;

/// <summary>
/// Test-only <see cref="IHubDeviceRepository"/> decorator that simulates household
/// teardown purging a device row between the touch's read and its write (#222).
/// When <see cref="DeleteAfterNextRead"/> is armed, the next successful
/// <see cref="GetAsync"/> deletes the row from the underlying store (one-shot) and
/// still hands back the entity it read, exactly as a purge landing mid-touch would.
/// </summary>
public sealed class RacingHubDeviceRepository : IHubDeviceRepository
{
    private readonly IHubDeviceRepository _inner;
    private readonly IEntityRepository<HubDeviceEntity> _entities;

    public RacingHubDeviceRepository(IHubDeviceRepository inner, IEntityRepository<HubDeviceEntity> entities)
    {
        ArgumentNullException.ThrowIfNull(inner);
        ArgumentNullException.ThrowIfNull(entities);
        _inner = inner;
        _entities = entities;
    }

    /// <summary>
    /// When <c>true</c>, the next read that finds a row deletes it right after
    /// reading, then clears itself.
    /// </summary>
    public bool DeleteAfterNextRead { get; set; }

    /// <inheritdoc />
    public Task AddAsync(string householdId, HubDeviceEntity device, CancellationToken cancellationToken = default) =>
        _inner.AddAsync(householdId, device, cancellationToken);

    /// <inheritdoc />
    public async Task<HubDeviceEntity?> GetAsync(string householdId, string deviceId, CancellationToken cancellationToken = default)
    {
        var device = await _inner.GetAsync(householdId, deviceId, cancellationToken);
        if (device is not null && DeleteAfterNextRead)
        {
            DeleteAfterNextRead = false;

            // The purge lands now: the caller keeps the entity it already read.
            await _entities.DeleteAsync(householdId, deviceId, OptimisticConcurrency.Wildcard, cancellationToken);
        }

        return device;
    }

    /// <inheritdoc />
    public Task UpdateAsync(string householdId, HubDeviceEntity device, string ifMatch, CancellationToken cancellationToken = default) =>
        _inner.UpdateAsync(householdId, device, ifMatch, cancellationToken);
}
