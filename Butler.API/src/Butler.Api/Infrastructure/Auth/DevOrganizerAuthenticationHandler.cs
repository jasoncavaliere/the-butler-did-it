using System.Security.Claims;
using System.Text.Encodings.Web;
using Butler.Api.Application.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Butler.Api.Infrastructure.Auth;

/// <summary>
/// Development-only authentication handler: every request is authenticated as a
/// deterministic dev organizer so the <c>Organizer</c> policy is satisfied
/// without a live Entra tenant (Engineering Contract 7.4). Registered only when
/// <c>Authentication:DisableAuthentication</c> is set, which is refused outside
/// Development - so this never runs in a deployed environment.
/// </summary>
public sealed class DevOrganizerAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public DevOrganizerAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : base(options, logger, encoder)
    {
    }

    /// <summary>Always succeeds with the fixed dev-organizer principal.</summary>
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, OrganizerAuthorization.DevOrganizerSubject),
            new Claim(ClaimTypes.Name, OrganizerAuthorization.DevOrganizerName),
            new Claim(ClaimTypes.Role, OrganizerAuthorization.OrganizerRole),
        };

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, Scheme.Name);

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
