namespace Butler.Api.Application.Capture;

/// <summary>
/// The simulated voice capture source (G3, BRD decision D-5). It takes a
/// transcript - "Hey Butler, add oat milk." - and does the one thing a speech
/// transport owes the rest of the system: strip the wake word, then hand a plain
/// utterance to the same <see cref="ICaptureHandler"/> the hub text source uses.
/// It resolves nothing and writes nothing itself.
/// </summary>
/// <remarks>
/// "Simulated" means the transcript arrives as text over the API rather than from
/// a speech service: the voice path is exercised end to end with no external
/// dependency. <b>Live Alexa capture is out of scope for this ticket</b> (BRD
/// Section 9 fast-follow); when it lands it is another
/// <see cref="ICaptureSource"/> beside this one, not a change to the handler.
/// </remarks>
public sealed class SimulatedVoiceCaptureSource : ICaptureSource
{
    // Longest first, so "hey butler" is not mistaken for a bare "butler" followed
    // by a stray word.
    private static readonly string[] WakeWords = ["hey butler", "ok butler", "okay butler", "butler"];

    // What typically separates a wake word from the request itself.
    private static readonly char[] WakeWordSeparators = [' ', ',', '.', '!', '?', ':', ';'];

    private readonly ICaptureHandler _handler;

    public SimulatedVoiceCaptureSource(ICaptureHandler handler)
    {
        ArgumentNullException.ThrowIfNull(handler);
        _handler = handler;
    }

    /// <inheritdoc />
    public string SourceName => CaptureSourceNames.SimulatedVoice;

    /// <inheritdoc />
    public Task<CaptureResult> CaptureAsync(
        CaptureRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        return _handler.ResolveAndAddAsync(
            SourceName,
            request with { Utterance = NormalizeTranscript(request.Utterance) },
            cancellationToken);
    }

    /// <summary>
    /// Normalizes a spoken transcript: drop one leading wake word and whatever
    /// punctuation followed it. Sentence punctuation elsewhere is left for
    /// <see cref="UtteranceNormalizer"/>, which both sources share.
    /// </summary>
    internal static string NormalizeTranscript(string? transcript)
    {
        var text = (transcript ?? string.Empty).Trim();

        foreach (var wakeWord in WakeWords)
        {
            if (text.StartsWith(wakeWord, StringComparison.OrdinalIgnoreCase))
            {
                text = text[wakeWord.Length..].TrimStart(WakeWordSeparators);
                break;
            }
        }

        return text.Trim();
    }
}
