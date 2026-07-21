namespace Butler.Api.Application.HubDevices;

/// <summary>
/// The result of pairing a tablet as a household's hub device (T5). The caller
/// keeps <see cref="Token"/> and presents it on the
/// <see cref="Butler.Api.Application.Auth.DeviceToken.HeaderName"/> header for
/// subsequent reads and completion writes; the identity fields are echoed so the
/// hub can confirm the pairing without a second read. The token grants no
/// organizer authority and is scoped to exactly <see cref="HouseholdId"/>.
/// </summary>
/// <param name="HouseholdId">The household the device (and its token) is scoped to.</param>
/// <param name="DeviceId">The server-generated id of the paired device.</param>
/// <param name="DeviceName">The human-readable name given to the paired tablet.</param>
/// <param name="PairedUtc">When the device was paired.</param>
/// <param name="Token">The long-lived, opaque device token to replay on later requests.</param>
public sealed record HubDevicePairingResponse(
    string HouseholdId,
    string DeviceId,
    string DeviceName,
    DateTimeOffset PairedUtc,
    string Token);
