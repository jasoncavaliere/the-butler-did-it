using System.Security.Claims;
using System.Text.Encodings.Web;
using Butler.Api.Application.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Butler.Api.Infrastructure.Auth;

/// <summary>
/// Authenticates a tap-to-claim participant session (T1). It decodes the
/// <see cref="ParticipantSession.HeaderName"/> request header into a principal
/// scoped to a single <c>(householdId, personId)</c> pair, carrying the
/// <see cref="OrganizerAuthorization.ParticipantRole"/> - and deliberately never
/// the organizer role, so the principal is authenticated for completion writes
/// yet is forbidden (<c>403</c>) at any <c>Organizer</c>-policy endpoint. A
/// missing or malformed token yields no principal (the caller stays
/// unauthenticated).
/// </summary>
public sealed class ParticipantSessionAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public ParticipantSessionAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : base(options, logger, encoder)
    {
    }

    /// <inheritdoc />
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        // A missing header renders as an empty string, which TryDecode rejects, so
        // there is a single "no valid session" path.
        var token = Request.Headers[ParticipantSession.HeaderName].ToString();
        if (!ParticipantSession.TryDecode(token, out var householdId, out var personId))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, personId),
            new Claim(ParticipantSession.HouseholdIdClaimType, householdId),
            new Claim(ClaimTypes.Role, OrganizerAuthorization.ParticipantRole),
        };

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, Scheme.Name);

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
