namespace Butler.Api.Application.Capture;

/// <summary>
/// The one resolve-and-add handler every <see cref="ICaptureSource"/> shares
/// (G3). Text and voice differ only in how their input arrives; from the term
/// onward there is a single behaviour - extract the product term, resolve it
/// through the G1 <see cref="Grocery.IStoreConnector"/>, and add the resolved
/// product to the household's G2 building cart. Keeping that in one place is what
/// makes "two sources, not two code paths" true rather than aspirational.
/// </summary>
public interface ICaptureHandler
{
    /// <summary>
    /// Resolves <paramref name="request"/>'s utterance and adds the resolved
    /// product to the household's current building cart. Returns a structured
    /// <see cref="CaptureResult"/> for every input, including the ones that add
    /// nothing.
    /// </summary>
    /// <param name="captureSource">
    /// The calling source's <see cref="ICaptureSource.SourceName"/>, stamped on
    /// the result.
    /// </param>
    /// <param name="request">The capture attempt.</param>
    /// <param name="cancellationToken">A cancellation token.</param>
    /// <exception cref="Carts.CartAlreadyConfirmedException">
    /// The week's cart has already been confirmed (G4), so it accepts no more
    /// items (a <c>409</c>).
    /// </exception>
    Task<CaptureResult> ResolveAndAddAsync(
        string captureSource,
        CaptureRequest request,
        CancellationToken cancellationToken = default);
}
