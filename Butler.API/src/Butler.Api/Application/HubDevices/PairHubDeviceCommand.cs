using MediatR;

namespace Butler.Api.Application.HubDevices;

/// <summary>
/// Pairs the current tablet as the household's hub device (T5). Pairing is a
/// sensitive action, so the controller only reaches this after the
/// <c>Organizer</c> policy is satisfied (Engineering Contract 7.4); the handler
/// stays free of the HTTP context.
/// </summary>
/// <param name="HouseholdId">The household the device is paired into.</param>
/// <param name="DeviceName">The human-readable name for the paired tablet.</param>
public sealed record PairHubDeviceCommand(string HouseholdId, string DeviceName)
    : IRequest<HubDevicePairingResponse>;

/// <summary>Handles <see cref="PairHubDeviceCommand"/> via the application service.</summary>
public sealed class PairHubDeviceCommandHandler : IRequestHandler<PairHubDeviceCommand, HubDevicePairingResponse>
{
    private readonly IHubDeviceService _devices;

    public PairHubDeviceCommandHandler(IHubDeviceService devices)
    {
        ArgumentNullException.ThrowIfNull(devices);
        _devices = devices;
    }

    public Task<HubDevicePairingResponse> Handle(PairHubDeviceCommand request, CancellationToken cancellationToken) =>
        _devices.PairAsync(request.HouseholdId, request.DeviceName, cancellationToken);
}
