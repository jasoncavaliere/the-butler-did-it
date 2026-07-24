using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Capture;
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
        var handler = new CaptureUtteranceCommandHandler([text, voice]);

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
        var handler = new CaptureUtteranceCommandHandler([NewSource(CaptureSourceNames.HubText)]);

        var ex = await Assert.ThrowsAsync<ValidationException>(
            () => handler.Handle(NewCommand("alexa"), CancellationToken.None));

        Assert.Contains("alexa", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Handle_rejects_a_null_command()
    {
        var handler = new CaptureUtteranceCommandHandler([NewSource(CaptureSourceNames.HubText)]);

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => handler.Handle(null!, CancellationToken.None));
    }

    [Fact]
    public void The_command_handler_rejects_a_null_source_set()
    {
        Assert.Throws<ArgumentNullException>(() => new CaptureUtteranceCommandHandler(null!));
    }
}
