using Butler.Api.Application.Rooms;
using Butler.Api.Infrastructure.Rooms;
using NSubstitute;

namespace Butler.Api.Tests.Rooms;

/// <summary>
/// Unit tests for <see cref="RoomService"/> exercised against an NSubstitute fake
/// of the persistence seam. They pin the orchestration the integration tests
/// cannot easily force: an unknown room resolves to a not-found signal on read,
/// update, and delete, and the service fails loudly if a just-written row cannot
/// be read back.
/// </summary>
public sealed class RoomServiceTests
{
    private const string Household = "house-1";

    [Fact]
    public async Task CreateAsync_throws_when_the_created_room_cannot_be_read_back()
    {
        var rooms = Substitute.For<IRoomRepository>();
        rooms
            .GetAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((RoomEntity?)null);

        var service = new RoomService(rooms);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.CreateAsync(Household, "Kitchen", 1, CancellationToken.None));
    }

    [Fact]
    public async Task GetAsync_returns_null_when_the_room_does_not_exist()
    {
        var rooms = Substitute.For<IRoomRepository>();
        rooms
            .GetAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((RoomEntity?)null);

        var service = new RoomService(rooms);

        Assert.Null(await service.GetAsync(Household, "room-1", CancellationToken.None));
    }

    [Fact]
    public async Task UpdateAsync_returns_null_when_the_room_does_not_exist()
    {
        var rooms = Substitute.For<IRoomRepository>();
        rooms
            .GetAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((RoomEntity?)null);

        var service = new RoomService(rooms);

        var result = await service.UpdateAsync(Household, "room-1", "Kitchen", 1, "*", CancellationToken.None);

        Assert.Null(result);
        await rooms.DidNotReceive().UpdateAsync(
            Arg.Any<string>(), Arg.Any<RoomEntity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task UpdateAsync_throws_when_the_updated_room_cannot_be_read_back()
    {
        var rooms = Substitute.For<IRoomRepository>();
        // First read (existence pre-check) finds the room; the post-update
        // re-read returns nothing.
        rooms.GetAsync(Household, "room-1", Arg.Any<CancellationToken>())
            .Returns(
                _ => new RoomEntity { PartitionKey = Household, RowKey = "room-1", Name = "Old", SortOrder = 1 },
                _ => null);

        var service = new RoomService(rooms);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.UpdateAsync(Household, "room-1", "New", 2, "*", CancellationToken.None));
    }

    [Fact]
    public async Task DeleteAsync_returns_false_when_the_room_does_not_exist()
    {
        var rooms = Substitute.For<IRoomRepository>();
        rooms
            .GetAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((RoomEntity?)null);

        var service = new RoomService(rooms);

        Assert.False(await service.DeleteAsync(Household, "room-1", CancellationToken.None));
        await rooms.DidNotReceive().DeleteAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeleteAsync_removes_the_room_when_it_exists()
    {
        var rooms = Substitute.For<IRoomRepository>();
        rooms.GetAsync(Household, "room-1", Arg.Any<CancellationToken>())
            .Returns(new RoomEntity { PartitionKey = Household, RowKey = "room-1" });

        var service = new RoomService(rooms);

        Assert.True(await service.DeleteAsync(Household, "room-1", CancellationToken.None));
        await rooms.Received(1).DeleteAsync(
            Household, "room-1", Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }
}
