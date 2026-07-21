using Butler.Api.Application.Auth;
using Butler.Api.Application.HubDevices;
using Butler.Api.Infrastructure.HubDevices;
using Butler.Api.Infrastructure.Storage;
using NSubstitute;

namespace Butler.Api.Tests.HubDevices;

/// <summary>
/// Unit tests for <see cref="HubDeviceService"/> exercised against the real
/// <see cref="TableHubDeviceRepository"/> over the in-memory store and a fixed
/// clock. They pin the T5 orchestration: pairing writes a household-scoped row
/// stamped from the clock and returns a token scoped to exactly
/// <c>(householdId, deviceId)</c>, and touching refreshes <c>LastSeenUtc</c> only
/// for a device that is still paired.
/// </summary>
public sealed class HubDeviceServiceTests
{
    private static readonly DateTimeOffset PairedAt = new(2026, 7, 20, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset SeenAt = new(2026, 7, 20, 18, 30, 0, TimeSpan.Zero);

    private static (HubDeviceService Service, IHubDeviceRepository Repository) NewService(TimeProvider clock)
    {
        var repository = new TableHubDeviceRepository(new InMemoryEntityRepository<HubDeviceEntity>());
        return (new HubDeviceService(repository, clock), repository);
    }

    [Fact]
    public async Task PairAsync_writes_a_row_stamped_from_the_clock_and_returns_a_scoped_token()
    {
        var clock = Substitute.For<TimeProvider>();
        clock.GetUtcNow().Returns(PairedAt);
        var (service, repository) = NewService(clock);

        var result = await service.PairAsync("house-1", "Kitchen hub", CancellationToken.None);

        Assert.Equal("house-1", result.HouseholdId);
        Assert.False(string.IsNullOrWhiteSpace(result.DeviceId));
        Assert.Equal("Kitchen hub", result.DeviceName);
        Assert.Equal(PairedAt, result.PairedUtc);

        // The token is opaque but decodes back to exactly the paired scope.
        Assert.True(DeviceToken.TryDecode(result.Token, out var household, out var device));
        Assert.Equal("house-1", household);
        Assert.Equal(result.DeviceId, device);

        // The persisted row carries the same scope, name, and clock-stamped times.
        var stored = await repository.GetAsync("house-1", result.DeviceId, CancellationToken.None);
        Assert.NotNull(stored);
        Assert.Equal("house-1", stored!.PartitionKey);
        Assert.Equal(result.DeviceId, stored.RowKey);
        Assert.Equal("Kitchen hub", stored.DeviceName);
        Assert.Equal(PairedAt, stored.PairedUtc);
        Assert.Equal(PairedAt, stored.LastSeenUtc);
    }

    [Fact]
    public async Task TouchAsync_refreshes_last_seen_from_the_clock_for_a_paired_device()
    {
        var clock = Substitute.For<TimeProvider>();
        // First call stamps PairedUtc/LastSeenUtc; second is the later touch.
        clock.GetUtcNow().Returns(PairedAt, SeenAt);
        var (service, repository) = NewService(clock);

        var paired = await service.PairAsync("house-1", "Kitchen hub", CancellationToken.None);

        var touched = await service.TouchAsync("house-1", paired.DeviceId, CancellationToken.None);

        Assert.True(touched);
        var stored = await repository.GetAsync("house-1", paired.DeviceId, CancellationToken.None);
        Assert.NotNull(stored);
        // PairedUtc is unchanged; only LastSeenUtc advances to the touch time.
        Assert.Equal(PairedAt, stored!.PairedUtc);
        Assert.Equal(SeenAt, stored.LastSeenUtc);
    }

    [Fact]
    public async Task TouchAsync_returns_false_for_a_device_that_is_not_paired()
    {
        var clock = Substitute.For<TimeProvider>();
        clock.GetUtcNow().Returns(SeenAt);
        var (service, _) = NewService(clock);

        var touched = await service.TouchAsync("house-1", "never-paired", CancellationToken.None);

        Assert.False(touched);
    }

    [Fact]
    public void Constructor_rejects_missing_dependencies()
    {
        var clock = Substitute.For<TimeProvider>();
        var repository = new TableHubDeviceRepository(new InMemoryEntityRepository<HubDeviceEntity>());

        Assert.Throws<ArgumentNullException>(() => new HubDeviceService(null!, clock));
        Assert.Throws<ArgumentNullException>(() => new HubDeviceService(repository, null!));
    }

    [Theory]
    [InlineData(null, "name")]
    [InlineData("", "name")]
    [InlineData("house-1", null)]
    [InlineData("house-1", "")]
    public async Task PairAsync_rejects_missing_arguments(string? householdId, string? deviceName)
    {
        var clock = Substitute.For<TimeProvider>();
        clock.GetUtcNow().Returns(PairedAt);
        var (service, _) = NewService(clock);

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => service.PairAsync(householdId!, deviceName!, CancellationToken.None));
    }
}
