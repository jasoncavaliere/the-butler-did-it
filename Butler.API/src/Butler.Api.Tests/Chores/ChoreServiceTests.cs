using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Chores;
using Butler.Api.Infrastructure.Chores;
using Butler.Api.Infrastructure.Rooms;
using NSubstitute;

namespace Butler.Api.Tests.Chores;

/// <summary>
/// Unit tests for <see cref="ChoreService"/> exercised against NSubstitute fakes
/// of the chore and room persistence seams. They pin the orchestration the
/// integration tests cannot easily force: an unknown chore resolves to a
/// not-found signal on read, update, and deactivate; a dangling or non-positive
/// input is rejected before any write; and the service fails loudly if a
/// just-written row cannot be read back.
/// </summary>
public sealed class ChoreServiceTests
{
    private const string Household = "house-1";
    private const string RoomId = "room-1";

    [Fact]
    public async Task CreateAsync_rejects_unknown_room_before_writing()
    {
        var chores = Substitute.For<IChoreRepository>();
        var rooms = Substitute.For<IRoomRepository>();
        rooms.GetAsync(Household, RoomId, Arg.Any<CancellationToken>()).Returns((RoomEntity?)null);

        var service = new ChoreService(chores, rooms);

        await Assert.ThrowsAsync<ValidationException>(
            () => service.CreateAsync(Household, "Dishes", RoomId, "Daily", 3, null, CancellationToken.None));
        await chores.DidNotReceive().AddAsync(
            Arg.Any<string>(), Arg.Any<ChoreEntity>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CreateAsync_rejects_a_blank_room_reference(string roomId)
    {
        var chores = Substitute.For<IChoreRepository>();
        var rooms = Substitute.For<IRoomRepository>();

        var service = new ChoreService(chores, rooms);

        await Assert.ThrowsAsync<ValidationException>(
            () => service.CreateAsync(Household, "Dishes", roomId, "Daily", 3, null, CancellationToken.None));
        await rooms.DidNotReceive().GetAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        await chores.DidNotReceive().AddAsync(
            Arg.Any<string>(), Arg.Any<ChoreEntity>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task CreateAsync_rejects_non_positive_effort_before_writing(int effort)
    {
        var chores = Substitute.For<IChoreRepository>();
        var rooms = Substitute.For<IRoomRepository>();

        var service = new ChoreService(chores, rooms);

        await Assert.ThrowsAsync<ValidationException>(
            () => service.CreateAsync(Household, "Dishes", RoomId, "Daily", effort, null, CancellationToken.None));
        await chores.DidNotReceive().AddAsync(
            Arg.Any<string>(), Arg.Any<ChoreEntity>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task CreateAsync_rejects_unknown_cadence_before_writing()
    {
        var chores = Substitute.For<IChoreRepository>();
        var rooms = Substitute.For<IRoomRepository>();

        var service = new ChoreService(chores, rooms);

        await Assert.ThrowsAsync<ValidationException>(
            () => service.CreateAsync(Household, "Dishes", RoomId, "Hourly", 3, null, CancellationToken.None));
    }

    [Fact]
    public async Task CreateAsync_throws_when_the_created_chore_cannot_be_read_back()
    {
        var chores = Substitute.For<IChoreRepository>();
        var rooms = Substitute.For<IRoomRepository>();
        rooms.GetAsync(Household, RoomId, Arg.Any<CancellationToken>())
            .Returns(new RoomEntity { PartitionKey = Household, RowKey = RoomId });
        chores.GetAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((ChoreEntity?)null);

        var service = new ChoreService(chores, rooms);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.CreateAsync(Household, "Dishes", RoomId, "Daily", 3, null, CancellationToken.None));
    }

    [Fact]
    public async Task GetAsync_returns_null_when_the_chore_does_not_exist()
    {
        var chores = Substitute.For<IChoreRepository>();
        var rooms = Substitute.For<IRoomRepository>();
        chores.GetAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((ChoreEntity?)null);

        var service = new ChoreService(chores, rooms);

        Assert.Null(await service.GetAsync(Household, "chore-1", CancellationToken.None));
    }

    [Fact]
    public async Task UpdateAsync_returns_null_when_the_chore_does_not_exist()
    {
        var chores = Substitute.For<IChoreRepository>();
        var rooms = Substitute.For<IRoomRepository>();
        chores.GetAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((ChoreEntity?)null);

        var service = new ChoreService(chores, rooms);

        var result = await service.UpdateAsync(
            Household, "chore-1", "Dishes", RoomId, "Daily", 3, null, true, "*", CancellationToken.None);

        Assert.Null(result);
        await chores.DidNotReceive().UpdateAsync(
            Arg.Any<string>(), Arg.Any<ChoreEntity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task UpdateAsync_rejects_unknown_room_without_writing()
    {
        var chores = Substitute.For<IChoreRepository>();
        var rooms = Substitute.For<IRoomRepository>();
        chores.GetAsync(Household, "chore-1", Arg.Any<CancellationToken>())
            .Returns(new ChoreEntity { PartitionKey = Household, RowKey = "chore-1", RoomId = RoomId });
        rooms.GetAsync(Household, "other-room", Arg.Any<CancellationToken>()).Returns((RoomEntity?)null);

        var service = new ChoreService(chores, rooms);

        await Assert.ThrowsAsync<ValidationException>(
            () => service.UpdateAsync(
                Household, "chore-1", "Dishes", "other-room", "Daily", 3, null, true, "*", CancellationToken.None));
        await chores.DidNotReceive().UpdateAsync(
            Arg.Any<string>(), Arg.Any<ChoreEntity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeactivateAsync_returns_null_when_the_chore_does_not_exist()
    {
        var chores = Substitute.For<IChoreRepository>();
        var rooms = Substitute.For<IRoomRepository>();
        chores.GetAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((ChoreEntity?)null);

        var service = new ChoreService(chores, rooms);

        Assert.Null(await service.DeactivateAsync(Household, "chore-1", CancellationToken.None));
        await chores.DidNotReceive().UpdateAsync(
            Arg.Any<string>(), Arg.Any<ChoreEntity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeactivateAsync_sets_active_false_and_persists()
    {
        var chores = Substitute.For<IChoreRepository>();
        var rooms = Substitute.For<IRoomRepository>();
        var stored = new ChoreEntity
        {
            PartitionKey = Household, RowKey = "chore-1", RoomId = RoomId, Active = true,
        };
        chores.GetAsync(Household, "chore-1", Arg.Any<CancellationToken>()).Returns(stored);

        var service = new ChoreService(chores, rooms);

        var result = await service.DeactivateAsync(Household, "chore-1", CancellationToken.None);

        Assert.NotNull(result);
        Assert.False(result!.Active);
        await chores.Received(1).UpdateAsync(
            Household,
            Arg.Is<ChoreEntity>(chore => !chore.Active),
            "*",
            Arg.Any<CancellationToken>());
    }
}
