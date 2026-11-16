using Butler.Api.Application.Chores;
using Butler.Api.Application.Households;
using Butler.Api.Application.HubDevices;
using Butler.Api.Application.People;
using Butler.Api.Application.Rooms;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Mediation;
using MediatR;
using NSubstitute;

namespace Butler.Api.Tests.Mediation;

/// <summary>
/// Criteria (#295 AC1, AC3): <see cref="HouseholdExistsBehavior{TRequest, TResponse}"/>
/// reads the household for an <see cref="IHouseholdWriteRequest"/> and throws
/// <see cref="HouseholdNotFoundException"/> before the handler runs when it is
/// missing; every other request passes through without a read. Every organizer
/// create and update command carries the marker.
/// </summary>
public sealed class HouseholdExistsBehaviorTests
{
    private const string HouseholdId = "h1";

    private sealed record MarkedRequest(string HouseholdId) : IRequest<string>, IHouseholdWriteRequest;

    private sealed record UnmarkedRequest(string HouseholdId) : IRequest<string>;

    [Fact]
    public void Constructor_rejects_a_null_repository() =>
        Assert.Throws<ArgumentNullException>(() => new HouseholdExistsBehavior<MarkedRequest, string>(null!));

    [Fact]
    public async Task Handle_rejects_a_null_next()
    {
        var behavior = new HouseholdExistsBehavior<MarkedRequest, string>(Substitute.For<IHouseholdRepository>());

        await Assert.ThrowsAsync<ArgumentNullException>(() =>
            behavior.Handle(new MarkedRequest(HouseholdId), null!, CancellationToken.None));
    }

    [Fact]
    public async Task An_unmarked_request_passes_through_without_a_household_read()
    {
        var households = Substitute.For<IHouseholdRepository>();
        var behavior = new HouseholdExistsBehavior<UnmarkedRequest, string>(households);

        var result = await behavior.Handle(
            new UnmarkedRequest(HouseholdId), () => Task.FromResult("handled"), CancellationToken.None);

        Assert.Equal("handled", result);
        await households.DidNotReceiveWithAnyArgs().GetAsync(default!, default);
    }

    [Fact]
    public async Task A_marked_request_for_an_existing_household_calls_next()
    {
        using var cts = new CancellationTokenSource();
        var households = Substitute.For<IHouseholdRepository>();
        households.GetAsync(HouseholdId, cts.Token)
            .Returns(new HouseholdEntity { PartitionKey = HouseholdId, RowKey = HouseholdId });
        var behavior = new HouseholdExistsBehavior<MarkedRequest, string>(households);

        var result = await behavior.Handle(
            new MarkedRequest(HouseholdId), () => Task.FromResult("handled"), cts.Token);

        Assert.Equal("handled", result);
        await households.Received(1).GetAsync(HouseholdId, cts.Token);
    }

    [Fact]
    public async Task A_marked_request_for_a_missing_household_throws_and_never_calls_next()
    {
        var households = Substitute.For<IHouseholdRepository>();
        households.GetAsync(HouseholdId, Arg.Any<CancellationToken>()).Returns((HouseholdEntity?)null);
        var behavior = new HouseholdExistsBehavior<MarkedRequest, string>(households);
        var nextCalled = false;

        var exception = await Assert.ThrowsAsync<HouseholdNotFoundException>(() =>
            behavior.Handle(
                new MarkedRequest(HouseholdId),
                () =>
                {
                    nextCalled = true;
                    return Task.FromResult("handled");
                },
                CancellationToken.None));

        Assert.Equal(HouseholdId, exception.HouseholdId);
        Assert.False(nextCalled);
    }

    [Theory]
    [InlineData(typeof(CreateRoomCommand))]
    [InlineData(typeof(UpdateRoomCommand))]
    [InlineData(typeof(CreatePersonCommand))]
    [InlineData(typeof(UpdatePersonCommand))]
    [InlineData(typeof(CreateChoreCommand))]
    [InlineData(typeof(UpdateChoreCommand))]
    [InlineData(typeof(DeactivateChoreCommand))]
    [InlineData(typeof(PairHubDeviceCommand))]
    public void Every_organizer_create_and_update_command_is_household_guarded(Type commandType) =>
        Assert.True(typeof(IHouseholdWriteRequest).IsAssignableFrom(commandType), commandType.Name);
}
