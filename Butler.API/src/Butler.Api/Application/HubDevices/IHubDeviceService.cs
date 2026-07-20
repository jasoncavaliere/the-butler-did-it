namespace Butler.Api.Application.HubDevices;

/// <summary>
/// Application service for the HubDevices feature (T5): pairing a tablet as a
/// household's long-lived hub device and touching an existing device's
/// <c>LastSeenUtc</c> when its token is presented.
/// </summary>
public interface IHubDeviceService
{
    /// <summary>
    /// Pairs a new hub device in the household: writes the <c>HubDevices</c> row
    /// (stamping <c>PairedUtc</c>/<c>LastSeenUtc</c> from the clock seam) and returns
    /// a long-lived device token scoped to exactly <c>(householdId, deviceId)</c>.
    /// </summary>
    Task<HubDevicePairingResponse> PairAsync(
        string householdId,
        string deviceName,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Refreshes the <c>LastSeenUtc</c> of an already-paired device from the clock
    /// seam. Returns <c>true</c> when the device exists (and was touched) and
    /// <c>false</c> when no such device is paired in the household, so a token for a
    /// removed device authenticates nobody.
    /// </summary>
    Task<bool> TouchAsync(
        string householdId,
        string deviceId,
        CancellationToken cancellationToken = default);
}
