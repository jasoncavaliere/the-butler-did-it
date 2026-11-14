using System.Security.Claims;
using System.Text.Encodings.Web;
using Butler.Api.Application.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Butler.Api.Tests.TestSupport;

/// <summary>
/// Test-only authentication handler that authenticates every request as an
/// organizer - an authenticated principal carrying the <c>Organizer</c> role.
/// Wiring it as the default scheme stands in for "a request with an organizer
/// token" in environments where the dev bypass is not allowed (for example
/// Production), without needing a live tenant to mint a JWT.
/// </summary>
public sealed class TestOrganizerAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    /// <summary>The scheme name to register and set as the default.</summary>
    public const string SchemeName = "TestOrganizer";

    public TestOrganizerAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : base(options, logger, encoder)
    {
    }

    /// <summary>Always succeeds with a fixed, authenticated organizer principal.</summary>
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, "test-organizer-22222222-2222-2222-2222-222222222222"),
            new Claim(ClaimTypes.Name, "Test Organizer"),
            new Claim(ClaimTypes.Role, OrganizerAuthorization.OrganizerRole),
        };

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, Scheme.Name);

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
