using Butler.Api.Infrastructure.HubDevices;
using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Tests.HubDevices;

/// <summary>
/// Unit tests for <see cref="TableHubDeviceRepository"/> over the in-memory store.
/// They pin the household scoping it delegates and the argument guards that keep a
/// malformed call from reaching the shared F3 seam.
/// </summary>
public sealed class TableHubDeviceRepositoryTests
{
    private static TableHubDeviceRepository NewRepository() =>
        new(new InMemoryEntityRepository<HubDeviceEntity>());

    private static HubDeviceEntity Device(string deviceId) => new()
    {
        RowKey = deviceId,
        DeviceName = "Hub",
        PairedUtc = DateTimeOffset.UnixEpoch,
        LastSeenUtc = DateTimeOffset.UnixEpoch,
    };

    [Fact]
    public async Task Add_then_get_round_trips_a_household_scoped_device()
    {
        var repository = NewRepository();

        await repository.AddAsync("house-1", Device("device-1"), CancellationToken.None);

        var stored = await repository.GetAsync("house-1", "device-1", CancellationToken.None);
        Assert.NotNull(stored);
        Assert.Equal("house-1", stored!.PartitionKey);
        Assert.Equal("device-1", stored.RowKey);

        // Scoping: the same device id in a different household is a separate row.
        Assert.Null(await repository.GetAsync("house-2", "device-1", CancellationToken.None));
    }

    [Fact]
    public async Task Upsert_replaces_the_stored_row()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", Device("device-1"), CancellationToken.None);

        var updated = Device("device-1");
        updated.LastSeenUtc = new DateTimeOffset(2030, 1, 1, 0, 0, 0, TimeSpan.Zero);
        await repository.UpsertAsync("house-1", updated, CancellationToken.None);

        var stored = await repository.GetAsync("house-1", "device-1", CancellationToken.None);
        Assert.Equal(new DateTimeOffset(2030, 1, 1, 0, 0, 0, TimeSpan.Zero), stored!.LastSeenUtc);
    }

    [Fact]
    public void Constructor_rejects_a_null_inner_repository()
    {
        Assert.Throws<ArgumentNullException>(() => new TableHubDeviceRepository(null!));
    }

    [Fact]
    public async Task AddAsync_rejects_a_null_device_or_blank_key()
    {
        var repository = NewRepository();

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => repository.AddAsync("house-1", null!, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(
            () => repository.AddAsync("house-1", Device(string.Empty), CancellationToken.None));
    }

    [Fact]
    public async Task UpsertAsync_rejects_a_null_device_or_blank_key()
    {
        var repository = NewRepository();

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => repository.UpsertAsync("house-1", null!, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(
            () => repository.UpsertAsync("house-1", Device(string.Empty), CancellationToken.None));
    }

    [Theory]
    [InlineData(null, "device-1")]
    [InlineData("", "device-1")]
    [InlineData("house-1", null)]
    [InlineData("house-1", "")]
    public async Task GetAsync_rejects_blank_scope(string? householdId, string? deviceId)
    {
        var repository = NewRepository();

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => repository.GetAsync(householdId!, deviceId!, CancellationToken.None));
    }
}
