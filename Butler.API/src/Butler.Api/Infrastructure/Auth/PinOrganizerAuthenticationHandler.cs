using System.Security.Claims;
using System.Text.Encodings.Web;
using Butler.Api.Application.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace Butler.Api.Infrastructure.Auth;

/// <summary>
/// Authenticates the local demo PIN organizer (#105). It reads an
/// <c>Authorization: Bearer</c> token issued by <c>POST /auth/pin/sign-in</c>
/// and asks <see cref="IPinOrganizerSessions"/> whether it is live, which also
/// restarts its idle window (so every authenticated request is a "use"). A live
/// token yields an organizer principal with
/// <see cref="OrganizerAuthorization.DevOrganizerSubject"/> (the organizer the
/// demo seed binds), so the existing <c>Organizer</c> policies accept it.
/// </summary>
public sealed class PinOrganizerAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    /// <summary>The <c>Authorization</c> scheme prefix the token is sent with.</summary>
    public const string BearerPrefix = "Bearer ";

    private readonly IPinOrganizerSessions _sessions;

    public PinOrganizerAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        IPinOrganizerSessions sessions)
        : base(options, logger, encoder)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        _sessions = sessions;
    }

    /// <summary>
    /// Reads the bearer token from <paramref name="authorization"/>, or
    /// <c>null</c> when the header is missing, not a bearer, or empty.
    /// </summary>
    public static string? ReadBearerToken(string? authorization)
    {
        if (authorization is null
            || !authorization.StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var token = authorization[BearerPrefix.Length..].Trim();
        return token.Length == 0 ? null : token;
    }

    /// <inheritdoc />
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var token = ReadBearerToken(Request.Headers[HeaderNames.Authorization].ToString());
        if (token is null)
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        if (!_sessions.TryTouch(token))
        {
            return Task.FromResult(AuthenticateResult.Fail("The organizer token is unknown, expired, or signed out."));
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, OrganizerAuthorization.DevOrganizerSubject),
            new Claim(ClaimTypes.Name, OrganizerAuthorization.PinOrganizerName),
            new Claim(ClaimTypes.Role, OrganizerAuthorization.OrganizerRole),
        };

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, Scheme.Name);

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
