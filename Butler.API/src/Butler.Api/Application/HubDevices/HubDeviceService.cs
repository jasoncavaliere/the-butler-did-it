using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.HubDevices;

namespace Butler.Api.Application.HubDevices;

/// <summary>
/// Default <see cref="IHubDeviceService"/>. Devices are a household-scoped table:
/// pairing stamps a server-generated <c>deviceId</c> and the paired/last-seen
/// timestamps from the injected clock, then mints an opaque device token scoped
/// to exactly <c>(householdId, deviceId)</c>. Touching re-reads the row and
/// upserts a fresh <c>LastSeenUtc</c> (last-writer-wins, no concurrency gate) so
/// presenting the token can never fail on a race.
/// </summary>
public sealed class HubDeviceService : IHubDeviceService
{
    private readonly IHubDeviceRepository _devices;
    private readonly TimeProvider _timeProvider;

    public HubDeviceService(IHubDeviceRepository devices, TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(devices);
        ArgumentNullException.ThrowIfNull(timeProvider);
        _devices = devices;
        _timeProvider = timeProvider;
    }

    /// <inheritdoc />
    public async Task<HubDevicePairingResponse> PairAsync(
        string householdId,
        string deviceName,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceName);

        var now = _timeProvider.GetUtcNow();
        var deviceId = NewId();
        var device = new HubDeviceEntity
        {
            PartitionKey = householdId,
            RowKey = deviceId,
            DeviceName = deviceName,
            PairedUtc = now,
            LastSeenUtc = now,
        };

        await _devices.AddAsync(householdId, device, cancellationToken).ConfigureAwait(false);

        var token = DeviceToken.Encode(householdId, deviceId);
        return new HubDevicePairingResponse(householdId, deviceId, deviceName, now, token);
    }

    /// <inheritdoc />
    public async Task<bool> TouchAsync(
        string householdId,
        string deviceId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);

        var device = await _devices.GetAsync(householdId, deviceId, cancellationToken).ConfigureAwait(false);
        if (device is null)
        {
            return false;
        }

        device.LastSeenUtc = _timeProvider.GetUtcNow();
        await _devices.UpsertAsync(householdId, device, cancellationToken).ConfigureAwait(false);
        return true;
    }

    // Server-generated, opaque, collision-resistant id (Contract 7.3 keys).
    private static string NewId() => Guid.NewGuid().ToString("N");
}
