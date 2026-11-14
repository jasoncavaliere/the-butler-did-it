namespace Butler.Api.Application.Auth;

/// <summary>
/// The <see cref="IPinOrganizerSessions"/> registered when the demo PIN organizer
/// is not the active mode (#105). It keeps the PIN command handlers resolvable
/// (the container validates them on build) while refusing any use: outside the
/// PIN mode <c>/auth/pin/*</c> is not mapped, so reaching it is a wiring bug.
/// </summary>
public sealed class DisabledPinOrganizerSessions : IPinOrganizerSessions
{
    /// <inheritdoc />
    public PinSignInResult SignIn(string pin) => throw NotEnabled();

    /// <inheritdoc />
    public bool TryTouch(string token) => throw NotEnabled();

    /// <inheritdoc />
    public void SignOut(string token) => throw NotEnabled();

    private static InvalidOperationException NotEnabled() =>
        new("The demo PIN organizer is not enabled (Authentication:Provider is not Pin).");
}
