using System.Security.Claims;
using System.Text.Encodings.Web;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Households;
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
/// unauthenticated); so does a token for a household that no longer exists, so
/// tearing a household down (#124) revokes every session it issued.
/// </summary>
public sealed class ParticipantSessionAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    private readonly IHouseholdService _households;

    public ParticipantSessionAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        IHouseholdService households)
        : base(options, logger, encoder)
    {
        ArgumentNullException.ThrowIfNull(households);
        _households = households;
    }

    /// <inheritdoc />
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        // A missing header renders as an empty string, which TryDecode rejects, so
        // there is a single "no valid session" path.
        var token = Request.Headers[ParticipantSession.HeaderName].ToString();
        if (!ParticipantSession.TryDecode(token, out var householdId, out var personId))
        {
            return AuthenticateResult.NoResult();
        }

        // The token is opaque and unsigned; the household row is the source of
        // truth. A session for a household that was torn down authenticates nobody.
        var household = await _households.GetAsync(householdId).ConfigureAwait(false);
        if (household is null)
        {
            return AuthenticateResult.NoResult();
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

        return AuthenticateResult.Success(ticket);
    }
}
