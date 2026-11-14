namespace Butler.Api.Application.Auth;

/// <summary>The outcome of a demo PIN sign-in attempt (#105).</summary>
public enum PinSignInOutcome
{
    /// <summary>The PIN matched; a fresh organizer token was issued.</summary>
    SignedIn,

    /// <summary>The PIN did not match.</summary>
    InvalidPin,

    /// <summary>Too many wrong PINs: every attempt is refused until the lockout ends.</summary>
    LockedOut,
}

/// <summary>The result of <see cref="IPinOrganizerSessions.SignIn"/>.</summary>
/// <param name="Outcome">What happened.</param>
/// <param name="Token">The issued organizer token, when <see cref="PinSignInOutcome.SignedIn"/>.</param>
/// <param name="IdleTimeout">The sliding idle expiry the token is subject to.</param>
/// <param name="RetryAfter">How long until a PIN is accepted again, when <see cref="PinSignInOutcome.LockedOut"/>.</param>
public sealed record PinSignInResult(
    PinSignInOutcome Outcome,
    string? Token,
    TimeSpan IdleTimeout,
    TimeSpan RetryAfter);
