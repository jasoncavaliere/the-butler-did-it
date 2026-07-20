using System.Security.Claims;
using System.Text.Encodings.Web;
using Butler.Api.Application.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Butler.Api.Tests.TestSupport;

/// <summary>
/// Test-only authentication handler that authenticates every request as a
/// household participant - an authenticated principal that deliberately lacks
/// the <c>Organizer</c> role. Wiring it as the default scheme lets a test drive
/// the authenticated-but-forbidden path: <c>RequireAuthenticatedUser()</c>
/// passes, <c>RequireRole(Organizer)</c> fails, and the Organizer policy yields
/// <c>403 Forbidden</c> (distinct from the unauthenticated <c>401</c>).
/// </summary>
public sealed class NonOrganizerAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    /// <summary>The scheme name to register and set as the default.</summary>
    public const string SchemeName = "TestNonOrganizer";

    public NonOrganizerAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : base(options, logger, encoder)
    {
    }

    /// <summary>Always succeeds with a fixed, authenticated non-organizer principal.</summary>
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, "test-participant-11111111-1111-1111-1111-111111111111"),
            new Claim(ClaimTypes.Name, "Test Participant"),
            new Claim(ClaimTypes.Role, OrganizerAuthorization.ParticipantRole),
        };

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, Scheme.Name);

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
