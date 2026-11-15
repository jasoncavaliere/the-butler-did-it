using Butler.Api.Application.Concurrency;
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
    public async Task Update_replaces_an_existing_row()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", Device("device-1"), CancellationToken.None);

        var updated = Device("device-1");
        updated.LastSeenUtc = new DateTimeOffset(2030, 1, 1, 0, 0, 0, TimeSpan.Zero);
        await repository.UpdateAsync("house-1", updated, OptimisticConcurrency.Wildcard, CancellationToken.None);

        var stored = await repository.GetAsync("house-1", "device-1", CancellationToken.None);
        Assert.Equal(new DateTimeOffset(2030, 1, 1, 0, 0, 0, TimeSpan.Zero), stored!.LastSeenUtc);
    }

    [Fact]
    public async Task Update_of_a_missing_row_throws_precondition_failed_and_inserts_nothing()
    {
        var repository = NewRepository();

        await Assert.ThrowsAsync<PreconditionFailedException>(
            () => repository.UpdateAsync("house-1", Device("device-1"), OptimisticConcurrency.Wildcard, CancellationToken.None));

        Assert.Null(await repository.GetAsync("house-1", "device-1", CancellationToken.None));
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
    public async Task UpdateAsync_rejects_a_null_device_or_blank_key()
    {
        var repository = NewRepository();

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => repository.UpdateAsync("house-1", null!, OptimisticConcurrency.Wildcard, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentException>(
            () => repository.UpdateAsync("house-1", Device(string.Empty), OptimisticConcurrency.Wildcard, CancellationToken.None));
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
