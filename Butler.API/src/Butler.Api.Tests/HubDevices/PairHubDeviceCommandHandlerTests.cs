using Butler.Api.Application.HubDevices;
using NSubstitute;

namespace Butler.Api.Tests.HubDevices;

/// <summary>
/// Unit tests for <see cref="PairHubDeviceCommandHandler"/>: it forwards the
/// command's household and device name to the application service and rejects a
/// missing service dependency.
/// </summary>
public sealed class PairHubDeviceCommandHandlerTests
{
    [Fact]
    public async Task Handle_forwards_to_the_service_and_returns_its_result()
    {
        var service = Substitute.For<IHubDeviceService>();
        var expected = new HubDevicePairingResponse(
            "house-1", "device-1", "Kitchen hub", DateTimeOffset.UnixEpoch, "token");
        service
            .PairAsync("house-1", "Kitchen hub", Arg.Any<CancellationToken>())
            .Returns(expected);
        var handler = new PairHubDeviceCommandHandler(service);

        var result = await handler.Handle(
            new PairHubDeviceCommand("house-1", "Kitchen hub"),
            CancellationToken.None);

        Assert.Same(expected, result);
        await service.Received(1).PairAsync("house-1", "Kitchen hub", Arg.Any<CancellationToken>());
    }

    [Fact]
    public void Constructor_rejects_a_null_service()
    {
        Assert.Throws<ArgumentNullException>(() => new PairHubDeviceCommandHandler(null!));
    }
}
