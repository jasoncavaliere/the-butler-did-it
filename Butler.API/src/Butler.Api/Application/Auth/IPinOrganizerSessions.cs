namespace Butler.Api.Application.Auth;

/// <summary>
/// The in-memory organizer sessions of the local demo PIN provider (#105): checks
/// a PIN with a failed-attempt lockout, issues short-lived opaque tokens, and
/// expires them after an idle period that each use restarts. Tokens live only in
/// the API's memory, so an API restart signs the organizer out.
/// </summary>
public interface IPinOrganizerSessions
{
    /// <summary>
    /// Checks <paramref name="pin"/>. While locked out every attempt is refused
    /// without checking the PIN, even the correct one.
    /// </summary>
    PinSignInResult SignIn(string pin);

    /// <summary>
    /// Whether <paramref name="token"/> is a live organizer token. A live token's
    /// idle window restarts; an idle-expired one is removed.
    /// </summary>
    bool TryTouch(string token);

    /// <summary>Revokes <paramref name="token"/>. Unknown tokens are ignored.</summary>
    void SignOut(string token);
}
