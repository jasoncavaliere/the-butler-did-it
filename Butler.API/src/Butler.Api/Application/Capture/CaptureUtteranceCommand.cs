using System.ComponentModel.DataAnnotations;
using MediatR;

namespace Butler.Api.Application.Capture;

/// <summary>
/// Captures one utterance through a named <see cref="ICaptureSource"/> (G3). The
/// result is always a structured <see cref="CaptureResult"/> - the controller maps
/// its outcome to a <c>200</c> or to an RFC 7807 problem details document.
/// </summary>
/// <param name="CaptureSource">
/// Which source to route through (a <see cref="CaptureSourceNames"/> constant).
/// </param>
/// <param name="HouseholdId">The household whose building cart receives the item.</param>
/// <param name="Utterance">The raw utterance, for example <c>"add oat milk"</c>.</param>
/// <param name="PersonId">The active participant/hub session the item is attributed to.</param>
/// <param name="WeekIso">The target ISO year-week, or <c>null</c> for the current week.</param>
/// <param name="Quantity">How many to add, or <c>null</c> for the default of one.</param>
public sealed record CaptureUtteranceCommand(
    string CaptureSource,
    string HouseholdId,
    string Utterance,
    string PersonId,
    string? WeekIso,
    int? Quantity) : IRequest<CaptureResult>;

/// <summary>
/// Routes a <see cref="CaptureUtteranceCommand"/> to the registered
/// <see cref="ICaptureSource"/> whose <see cref="ICaptureSource.SourceName"/>
/// matches. Sources are resolved as a set rather than by concrete type, so adding
/// the Section 9 live-assistant source later is a registration, not a change here.
/// </summary>
public sealed class CaptureUtteranceCommandHandler
    : IRequestHandler<CaptureUtteranceCommand, CaptureResult>
{
    private readonly IReadOnlyList<ICaptureSource> _sources;

    public CaptureUtteranceCommandHandler(IEnumerable<ICaptureSource> sources)
    {
        ArgumentNullException.ThrowIfNull(sources);
        _sources = sources.ToList();
    }

    public Task<CaptureResult> Handle(CaptureUtteranceCommand request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // An unknown source name is a client error (400), not a 500: the routes
        // only ever pass the two v1 constants, so this guards a caller reaching
        // the command directly.
        var source = _sources.FirstOrDefault(
                candidate => string.Equals(
                    candidate.SourceName, request.CaptureSource, StringComparison.Ordinal))
            ?? throw new ValidationException($"Unknown capture source '{request.CaptureSource}'.");

        return source.CaptureAsync(
            new CaptureRequest(
                request.HouseholdId,
                request.Utterance,
                request.PersonId,
                request.WeekIso,
                request.Quantity),
            cancellationToken);
    }
}
