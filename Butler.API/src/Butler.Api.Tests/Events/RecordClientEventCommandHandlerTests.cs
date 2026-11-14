using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Assignments;
using Butler.Api.Application.Events;
using Butler.Api.Application.People;
using Butler.Api.Infrastructure.Households;
using NSubstitute;

namespace Butler.Api.Tests.Events;

/// <summary>
/// Criterion (#122 AC7, AC8): the client-event handler checks the allowlist
/// before any I/O, answers <c>false</c> for an unknown household, and otherwise
/// records a <c>hub-glanced</c> event with the throwing recorder. Also guards
/// every handler that gained a recorder dependency.
/// </summary>
public sealed class RecordClientEventCommandHandlerTests
{
    private readonly IEventRecorder _recorder = Substitute.For<IEventRecorder>();
    private readonly IHouseholdRepository _households = Substitute.For<IHouseholdRepository>();

    private RecordClientEventCommandHandler NewHandler() => new(_recorder, _households);

    [Theory]
    [InlineData(EventTypes.ParticipantClaimed)]
    [InlineData(EventTypes.ChoreCompleted)]
    [InlineData("HUB-GLANCED")]
    [InlineData("")]
    [InlineData(null)]
    public async Task Disallowed_type_throws_before_any_io(string? type)
    {
        await Assert.ThrowsAsync<ValidationException>(
            () => NewHandler().Handle(new RecordClientEventCommand("house-1", type), CancellationToken.None));

        Assert.Empty(_households.ReceivedCalls());
        Assert.Empty(_recorder.ReceivedCalls());
    }

    [Fact]
    public async Task An_unknown_household_is_false_and_records_nothing()
    {
        _households.GetAsync("house-1", Arg.Any<CancellationToken>()).Returns((HouseholdEntity?)null);

        var recorded = await NewHandler().Handle(
            new RecordClientEventCommand("house-1", EventTypes.HubGlanced), CancellationToken.None);

        Assert.False(recorded);
        Assert.Empty(_recorder.ReceivedCalls());
    }

    [Fact]
    public async Task A_known_household_records_hub_glanced()
    {
        _households.GetAsync("house-1", Arg.Any<CancellationToken>()).Returns(new HouseholdEntity());

        var recorded = await NewHandler().Handle(
            new RecordClientEventCommand("house-1", EventTypes.HubGlanced), CancellationToken.None);

        Assert.True(recorded);
        await _recorder.Received(1).RecordAsync(
            "house-1", EventTypes.HubGlanced, null, null, null, null, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task A_null_command_is_rejected()
    {
        await Assert.ThrowsAsync<ArgumentNullException>(() => NewHandler().Handle(null!, CancellationToken.None));
    }

    [Fact]
    public void Every_handler_requires_its_collaborators()
    {
        Assert.Throws<ArgumentNullException>(() => new RecordClientEventCommandHandler(null!, _households));
        Assert.Throws<ArgumentNullException>(() => new RecordClientEventCommandHandler(_recorder, null!));

        var completions = Substitute.For<IChoreCompletionService>();
        Assert.Throws<ArgumentNullException>(() => new CompleteChoreCommandHandler(null!, _recorder));
        Assert.Throws<ArgumentNullException>(() => new CompleteChoreCommandHandler(completions, null!));
        Assert.Throws<ArgumentNullException>(() => new UndoChoreCommandHandler(null!, _recorder));
        Assert.Throws<ArgumentNullException>(() => new UndoChoreCommandHandler(completions, null!));

        var people = Substitute.For<IPersonService>();
        Assert.Throws<ArgumentNullException>(() => new ClaimPersonCommandHandler(null!, _recorder));
        Assert.Throws<ArgumentNullException>(() => new ClaimPersonCommandHandler(people, null!));
    }

    [Fact]
    public async Task Complete_and_undo_handlers_reject_a_null_command()
    {
        var completions = Substitute.For<IChoreCompletionService>();

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => new CompleteChoreCommandHandler(completions, _recorder).Handle(null!, CancellationToken.None));
        await Assert.ThrowsAsync<ArgumentNullException>(
            () => new UndoChoreCommandHandler(completions, _recorder).Handle(null!, CancellationToken.None));
    }
}
