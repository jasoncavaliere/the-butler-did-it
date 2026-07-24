namespace Butler.Api.Application.Capture;

/// <summary>
/// The hub text capture source (G3): someone types "oat milk" into the add field
/// on the shared tablet. Typed input arrives already clean, so this source's
/// normalization is a trim - everything else, including stripping a leading
/// "add", belongs to <see cref="UtteranceNormalizer"/> inside the shared
/// <see cref="ICaptureHandler"/> so the voice source gets it too.
/// </summary>
public sealed class HubTextCaptureSource : ICaptureSource
{
    private readonly ICaptureHandler _handler;

    public HubTextCaptureSource(ICaptureHandler handler)
    {
        ArgumentNullException.ThrowIfNull(handler);
        _handler = handler;
    }

    /// <inheritdoc />
    public string SourceName => CaptureSourceNames.HubText;

    /// <inheritdoc />
    public Task<CaptureResult> CaptureAsync(
        CaptureRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        return _handler.ResolveAndAddAsync(
            SourceName,
            request with { Utterance = NormalizeTypedText(request.Utterance) },
            cancellationToken);
    }

    /// <summary>
    /// Normalizes typed input: whitespace only. A hub keyboard produces no wake
    /// words and no transcription artefacts, so there is nothing else to undo.
    /// </summary>
    internal static string NormalizeTypedText(string? typed) => (typed ?? string.Empty).Trim();
}
