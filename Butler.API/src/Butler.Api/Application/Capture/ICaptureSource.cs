namespace Butler.Api.Application.Capture;

/// <summary>
/// The capture seam (BRD decision D-5, G3). A capture source turns whatever it
/// receives - text typed at the hub, a voice transcript, tomorrow a live
/// assistant webhook - into one operation: resolve an utterance to a product
/// through the G1 store connector and add it to the household's current building
/// cart (G2).
/// <para>
/// An implementation is a <b>thin normalizer</b>, not a second code path: it
/// converts its own transport's quirks (a wake word, stray punctuation) into a
/// plain utterance and hands it to the shared <see cref="ICaptureHandler"/>. That
/// is what keeps "typed" and "spoken" from drifting into two behaviours.
/// </para>
/// </summary>
/// <remarks>
/// v1 ships exactly two sources - <see cref="HubTextCaptureSource"/> and
/// <see cref="SimulatedVoiceCaptureSource"/>. <b>Live Alexa capture is out of
/// scope</b> (BRD Section 9 fast-follow): this interface is the seam it will be
/// added behind, without touching the resolve-and-add behaviour or any caller.
/// </remarks>
public interface ICaptureSource
{
    /// <summary>
    /// This source's identity (a <see cref="CaptureSourceNames"/> constant),
    /// stamped on every <see cref="CaptureResult"/> it produces.
    /// </summary>
    string SourceName { get; }

    /// <summary>
    /// Captures one utterance: normalize it for this transport, then resolve and
    /// add through the shared handler. Bad input never throws - an utterance with
    /// no product term, no match, or several equally plausible matches comes back
    /// as a structured <see cref="CaptureResult"/> the caller maps to a response.
    /// </summary>
    /// <param name="request">The utterance plus the household and actor it belongs to.</param>
    /// <param name="cancellationToken">A cancellation token.</param>
    Task<CaptureResult> CaptureAsync(CaptureRequest request, CancellationToken cancellationToken = default);
}

/// <summary>
/// One capture attempt. The utterance is free text; everything else is the
/// context the resulting cart line is written under.
/// </summary>
/// <param name="HouseholdId">The household whose building cart receives the item.</param>
/// <param name="Utterance">
/// The raw utterance, for example <c>"add oat milk"</c>. Interpreted by the
/// source's normalizer and then by
/// <see cref="UtteranceNormalizer.ExtractProductTerm"/>.
/// </param>
/// <param name="PersonId">
/// The active participant or hub session the item is attributed to
/// (<c>AddedByPersonId</c>, tap-to-claim decision D-3). Capture is not an
/// organizer-only action.
/// </param>
/// <param name="WeekIso">
/// The target ISO year-week, or <c>null</c> to let G2 resolve the current week
/// from the injected clock (Engineering Contract 7.5).
/// </param>
/// <param name="Quantity">
/// How many to add. <c>null</c> (or anything below <c>1</c>) means the default of
/// <see cref="CaptureHandler.DefaultQuantity"/>. Quantities are never parsed out
/// of the utterance itself in v1.
/// </param>
public sealed record CaptureRequest(
    string HouseholdId,
    string Utterance,
    string PersonId,
    string? WeekIso = null,
    int? Quantity = null);
