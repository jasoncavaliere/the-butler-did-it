using System.Net;
using Butler.Api.Application.Auth;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Hosting;

namespace Butler.Api.Tests.TapToClaim;

/// <summary>
/// Criterion (T1, mitigates BRD risk R-1): a participant session carries no
/// organizer authority. Presented to an <c>Organizer</c>-policy endpoint with
/// authentication enabled, it is authenticated-but-forbidden - a hard <c>403</c>,
/// never a <c>200</c> or a silent allow. A malformed session authenticates
/// nobody, so it is a <c>401</c>. The boundary is structural: the session never
/// holds the organizer role.
/// </summary>
public sealed class ParticipantSessionCannotDoSensitiveActionTests
{
    // GET /me is the reference Organizer-policy endpoint (Engineering Contract 7.4).
    private static readonly Uri OrganizerEndpoint = new("/me", UriKind.Relative);

    private static WebApplicationFactory<Program> CreateAuthEnabledFactory()
    {
        return new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(Environments.Production);
            builder.UseSetting("Authentication:DisableAuthentication", "false");
            builder.UseSetting(
                "Authentication:Authority",
                "https://login.example.com/00000000-0000-0000-0000-000000000000/v2.0");
            builder.UseSetting("Authentication:Audience", "api://butler-test");
        });
    }

    [Fact]
    public async Task A_participant_session_is_forbidden_at_an_organizer_endpoint()
    {
        using var factory = CreateAuthEnabledFactory();
        using var client = factory.CreateClient();

        // The exact token shape a claim mints, scoped to one (household, person).
        var token = ParticipantSession.Encode(
            Guid.NewGuid().ToString("N"),
            Guid.NewGuid().ToString("N"));

        using var request = new HttpRequestMessage(HttpMethod.Get, OrganizerEndpoint);
        request.Headers.TryAddWithoutValidation(ParticipantSession.HeaderName, token);
        using var response = await client.SendAsync(request);

        // Authenticated (so not a 401 challenge) but lacking the organizer role.
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_malformed_participant_session_authenticates_nobody()
    {
        using var factory = CreateAuthEnabledFactory();
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Get, OrganizerEndpoint);
        request.Headers.TryAddWithoutValidation(ParticipantSession.HeaderName, "not-a-real-token");
        using var response = await client.SendAsync(request);

        // No valid principal -> the policy's RequireAuthenticatedUser challenges (401).
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
