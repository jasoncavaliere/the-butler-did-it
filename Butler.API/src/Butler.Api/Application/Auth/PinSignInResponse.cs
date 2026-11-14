namespace Butler.Api.Application.Auth;

/// <summary>The body of a successful <c>POST /auth/pin/sign-in</c> (#105).</summary>
/// <param name="Token">The organizer bearer token (send as <c>Authorization: Bearer</c>).</param>
/// <param name="Subject">The organizer's subject (the demo seed's organizer).</param>
/// <param name="Name">The organizer's display name.</param>
/// <param name="IdleTimeoutSeconds">Seconds of non-use after which the token is rejected; each use restarts it.</param>
public sealed record PinSignInResponse(string Token, string Subject, string Name, int IdleTimeoutSeconds);
