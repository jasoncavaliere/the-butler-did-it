using Butler.Api.Application.Carts;
using Butler.Api.Application.Grocery;

namespace Butler.Api.Application.Capture;

/// <summary>
/// The distinguishable answers a capture attempt can produce. Every one of them
/// is a value the caller maps to a response - none of them is an exception, which
/// is what keeps a mumbled utterance from becoming a <c>500</c>.
/// </summary>
public enum CaptureOutcome
{
    /// <summary>The utterance resolved to one product and it is now in the cart.</summary>
    Added,

    /// <summary>
    /// The utterance matched several products and none of them was an obvious
    /// winner, so the candidates come back as suggestions rather than a silent
    /// guess.
    /// </summary>
    Ambiguous,

    /// <summary>The store connector matched nothing for the extracted term.</summary>
    NoMatch,

    /// <summary>
    /// Nothing product-shaped survived normalization (for example a bare
    /// <c>"add"</c>, or a transcript that was only a wake word).
    /// </summary>
    EmptyTerm,

    /// <summary>The household does not exist, so there is no cart to add to.</summary>
    HouseholdNotFound,
}

/// <summary>
/// The structured outcome of one capture attempt (G3 AC: a clear, structured
/// result - suggestions or a problem detail - and never an unhandled exception).
/// Construct it through the static factories so an outcome and its payload can
/// never disagree: only <see cref="CaptureOutcome.Added"/> carries an
/// <see cref="Item"/>, and only <see cref="CaptureOutcome.Ambiguous"/> carries
/// <see cref="Suggestions"/>.
/// </summary>
/// <param name="Outcome">Which of the distinguishable answers this is.</param>
/// <param name="CaptureSource">The <see cref="ICaptureSource"/> that produced it.</param>
/// <param name="ResolvedTerm">
/// The product term normalization extracted from the utterance - echoed back so a
/// caller can show <i>what Butler actually heard</i> rather than the raw sentence.
/// </param>
/// <param name="WeekIso">
/// The cart's ISO year-week, when a cart was resolved; <c>null</c> when the
/// attempt failed before that point.
/// </param>
/// <param name="Item">The line that was added, on <see cref="CaptureOutcome.Added"/> only.</param>
/// <param name="Suggestions">
/// Candidate products, on <see cref="CaptureOutcome.Ambiguous"/> only; empty
/// otherwise.
/// </param>
public sealed record CaptureResult(
    CaptureOutcome Outcome,
    string CaptureSource,
    string ResolvedTerm,
    string? WeekIso,
    CartItemView? Item,
    IReadOnlyList<StoreProduct> Suggestions)
{
    /// <summary>The utterance resolved to one product, now in the week's cart.</summary>
    public static CaptureResult Added(
        string captureSource,
        string resolvedTerm,
        string weekIso,
        CartItemView item) =>
        new(CaptureOutcome.Added, captureSource, resolvedTerm, weekIso, item, []);

    /// <summary>
    /// Several products matched and none was an obvious winner. The candidates
    /// ride along so the caller can ask which one was meant.
    /// </summary>
    public static CaptureResult Ambiguous(
        string captureSource,
        string resolvedTerm,
        string weekIso,
        IReadOnlyList<StoreProduct> candidates) =>
        new(CaptureOutcome.Ambiguous, captureSource, resolvedTerm, weekIso, null, candidates);

    /// <summary>The connector matched nothing for the extracted term.</summary>
    public static CaptureResult NoMatch(string captureSource, string resolvedTerm, string weekIso) =>
        new(CaptureOutcome.NoMatch, captureSource, resolvedTerm, weekIso, null, []);

    /// <summary>Normalization left no product term to search for.</summary>
    public static CaptureResult EmptyTerm(string captureSource) =>
        new(CaptureOutcome.EmptyTerm, captureSource, string.Empty, null, null, []);

    /// <summary>The household does not exist, so no cart was touched.</summary>
    public static CaptureResult HouseholdNotFound(string captureSource, string resolvedTerm) =>
        new(CaptureOutcome.HouseholdNotFound, captureSource, resolvedTerm, null, null, []);
}
