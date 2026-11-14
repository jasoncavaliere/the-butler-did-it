using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Capture;
using Butler.Api.Application.Carts;
using Butler.Api.Application.Events;
using NSubstitute;

namespace Butler.Api.Tests.Capture;

/// <summary>
/// The MediatR seam in front of capture: a command names a source, and the handler
/// routes it to the registered <see cref="ICaptureSource"/> whose name matches -
/// resolving the set rather than a concrete type, so the Section 9 live-assistant
/// source is a registration rather than a change here. An unknown name is a client
/// error, never a <c>500</c>.
/// </summary>
public sealed class CaptureUtteranceCommandTests
{
    private static ICaptureSource NewSource(string sourceName)
    {
        var source = Substitute.For<ICaptureSource>();
        source.SourceName.Returns(sourceName);
        source
            .CaptureAsync(Arg.Any<CaptureRequest>(), Arg.Any<CancellationToken>())
            .Returns(CaptureResult.NoMatch(sourceName, "eggs", "2026-W30"));
        return source;
    }

    private static CaptureUtteranceCommand NewCommand(string captureSource) =>
        new(captureSource, "household-1", "add eggs", "person-1", "2026-W30", 2);

    [Fact]
    public async Task Handle_routes_to_the_source_whose_name_matches()
    {
        var text = NewSource(CaptureSourceNames.HubText);
        var voice = NewSource(CaptureSourceNames.SimulatedVoice);
        var handler = new CaptureUtteranceCommandHandler([text, voice], Substitute.For<IEventRecorder>());

        var result = await handler.Handle(
            NewCommand(CaptureSourceNames.SimulatedVoice), CancellationToken.None);

        Assert.Equal(CaptureSourceNames.SimulatedVoice, result.CaptureSource);
        await voice
            .Received(1)
            .CaptureAsync(
                Arg.Is<CaptureRequest>(request =>
                    request.HouseholdId == "household-1"
                    && request.Utterance == "add eggs"
                    && request.PersonId == "person-1"
                    && request.WeekIso == "2026-W30"
                    && request.Quantity == 2),
                Arg.Any<CancellationToken>());
        await text
            .DidNotReceive()
            .CaptureAsync(Arg.Any<CaptureRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Handle_rejects_an_unknown_capture_source()
    {
        var handler = new CaptureUtteranceCommandHandler([NewSource(CaptureSourceNames.HubText)], Substitute.For<IEventRecorder>());

        var ex = await Assert.ThrowsAsync<ValidationException>(
            () => handler.Handle(NewCommand("alexa"), CancellationToken.None));

        Assert.Contains("alexa", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Handle_rejects_a_null_command()
    {
        var handler = new CaptureUtteranceCommandHandler([NewSource(CaptureSourceNames.HubText)], Substitute.For<IEventRecorder>());

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => handler.Handle(null!, CancellationToken.None));
    }

    [Fact]
    public void The_command_handler_rejects_a_null_source_set()
    {
        Assert.Throws<ArgumentNullException>(
            () => new CaptureUtteranceCommandHandler(null!, Substitute.For<IEventRecorder>()));
    }

    [Fact]
    public void The_command_handler_rejects_a_null_event_recorder()
    {
        Assert.Throws<ArgumentNullException>(
            () => new CaptureUtteranceCommandHandler([NewSource(CaptureSourceNames.HubText)], null!));
    }

    [Fact]
    public async Task Added_outcome_records_cart_item_added()
    {
        var source = Substitute.For<ICaptureSource>();
        source.SourceName.Returns(CaptureSourceNames.HubText);
        var item = new CartItemView("item-9", "heb-eggs", "Eggs", 2, "person-1", "simulated-heb");
        source
            .CaptureAsync(Arg.Any<CaptureRequest>(), Arg.Any<CancellationToken>())
            .Returns(CaptureResult.Added(CaptureSourceNames.HubText, "eggs", "2026-W30", item));
        var recorder = Substitute.For<IEventRecorder>();
        var handler = new CaptureUtteranceCommandHandler([source], recorder);

        var result = await handler.Handle(NewCommand(CaptureSourceNames.HubText), CancellationToken.None);

        Assert.Equal(CaptureOutcome.Added, result.Outcome);
        await recorder.Received(1).TryRecordAsync(
            "household-1",
            EventTypes.CartItemAdded,
            "person-1",
            null,
            "2026-W30",
            "item-9",
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Non_added_outcomes_record_nothing()
    {
        var recorder = Substitute.For<IEventRecorder>();
        var handler = new CaptureUtteranceCommandHandler([NewSource(CaptureSourceNames.HubText)], recorder);

        var result = await handler.Handle(NewCommand(CaptureSourceNames.HubText), CancellationToken.None);

        Assert.Equal(CaptureOutcome.NoMatch, result.Outcome);
        Assert.Empty(recorder.ReceivedCalls());
    }
}
