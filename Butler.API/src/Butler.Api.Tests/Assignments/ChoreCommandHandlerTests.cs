using Butler.Api.Application.Assignments;
using Butler.Api.Application.Events;
using NSubstitute;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Criterion (#218 AC1, AC2, AC4): the complete and undo handlers record their
/// usage event only when the service reports an actual state change. An
/// idempotent replay records nothing, a real transition records exactly once,
/// and an unknown assignment (a <c>null</c> result) records nothing and stays
/// <c>null</c> so the controller can map it to a <c>404</c>.
/// </summary>
public sealed class ChoreCommandHandlerTests
{
    private const string HouseholdId = "house-1";
    private const string Week = "2026-W29";
    private const string ChoreId = "chore-1";
    private const string PersonId = "person-1";

    private readonly IChoreCompletionService _completions = Substitute.For<IChoreCompletionService>();
    private readonly IEventRecorder _recorder = Substitute.For<IEventRecorder>();

    private static CompleteChoreResponse Completed() => new(Week, ChoreId, PersonId, "Done");

    private static UndoChoreResponse Reopened() => new(Week, ChoreId, PersonId, "Open");

    private void CompleteReturns(CompleteChoreResult? result) =>
        _completions
            .CompleteAsync(HouseholdId, Week, ChoreId, PersonId, Arg.Any<CancellationToken>())
            .Returns(result);

    private void UndoReturns(UndoChoreResult? result) =>
        _completions
            .UndoAsync(HouseholdId, Week, ChoreId, PersonId, Arg.Any<CancellationToken>())
            .Returns(result);

    private Task<CompleteChoreResponse?> CompleteAsync() =>
        new CompleteChoreCommandHandler(_completions, _recorder).Handle(
            new CompleteChoreCommand(HouseholdId, Week, ChoreId, PersonId), CancellationToken.None);

    private Task<UndoChoreResponse?> UndoAsync() =>
        new UndoChoreCommandHandler(_completions, _recorder).Handle(
            new UndoChoreCommand(HouseholdId, Week, ChoreId, PersonId), CancellationToken.None);

    [Fact]
    public async Task Complete_handler_records_once_when_state_changes()
    {
        var response = Completed();
        CompleteReturns(new CompleteChoreResult(response, Changed: true));

        var result = await CompleteAsync();

        Assert.Same(response, result);
        await _recorder.Received(1).TryRecordAsync(
            HouseholdId,
            EventTypes.ChoreCompleted,
            PersonId,
            ChoreId,
            Week,
            null,
            Arg.Any<CancellationToken>());
        Assert.Single(_recorder.ReceivedCalls());
    }

    [Fact]
    public async Task Complete_handler_records_nothing_on_an_idempotent_replay()
    {
        var response = Completed();
        CompleteReturns(new CompleteChoreResult(response, Changed: false));

        var result = await CompleteAsync();

        Assert.Same(response, result);
        Assert.Empty(_recorder.ReceivedCalls());
    }

    [Fact]
    public async Task Complete_handler_records_nothing_for_an_unknown_assignment()
    {
        CompleteReturns(null);

        var result = await CompleteAsync();

        Assert.Null(result);
        Assert.Empty(_recorder.ReceivedCalls());
    }

    [Fact]
    public async Task Undo_handler_records_once_when_state_changes()
    {
        var response = Reopened();
        UndoReturns(new UndoChoreResult(response, Changed: true));

        var result = await UndoAsync();

        Assert.Same(response, result);
        await _recorder.Received(1).TryRecordAsync(
            HouseholdId,
            EventTypes.ChoreUndone,
            PersonId,
            ChoreId,
            Week,
            null,
            Arg.Any<CancellationToken>());
        Assert.Single(_recorder.ReceivedCalls());
    }

    [Fact]
    public async Task Undo_handler_records_nothing_on_an_idempotent_replay()
    {
        var response = Reopened();
        UndoReturns(new UndoChoreResult(response, Changed: false));

        var result = await UndoAsync();

        Assert.Same(response, result);
        Assert.Empty(_recorder.ReceivedCalls());
    }

    [Fact]
    public async Task Undo_handler_records_nothing_for_an_unknown_assignment()
    {
        UndoReturns(null);

        var result = await UndoAsync();

        Assert.Null(result);
        Assert.Empty(_recorder.ReceivedCalls());
    }
}
