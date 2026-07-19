using System.Net;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Hosting;

namespace Butler.Api.Tests.Auth;

/// <summary>
/// Criteria (Engineering Contract 7.4) for when authentication is enabled: the
/// <c>Organizer</c> policy denies an unauthenticated caller, and a
/// non-Development host fails closed (refuses to start) when auth is disabled or
/// misconfigured - mitigating BRD risk R-1 (a bypass leaking to production).
/// </summary>
public sealed class OrganizerPolicyTests
{
    /// <summary>
    /// Composes the real app (with the test controllers) but forces a specific
    /// environment and <c>Authentication</c> configuration for the scenario.
    /// </summary>
    private static WebApplicationFactory<Program> CreateFactory(
        string environment,
        Action<IWebHostBuilder> configure)
    {
        return new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            configure(builder);
        });
    }

    [Fact]
    public async Task Organizer_policy_denies_an_unauthenticated_caller_when_auth_is_enabled()
    {
        using var factory = CreateFactory(Environments.Production, builder =>
        {
            builder.UseSetting("Authentication:DisableAuthentication", "false");
            builder.UseSetting(
                "Authentication:Authority",
                "https://login.example.com/00000000-0000-0000-0000-000000000000/v2.0");
            builder.UseSetting("Authentication:Audience", "api://butler-test");
        });

        using var client = factory.CreateClient();

        using var response = await client.GetAsync(new Uri("/me", UriKind.Relative));

        // No token presented -> the policy's RequireAuthenticatedUser fails and
        // the JWT bearer scheme challenges with 401.
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public void Non_development_host_fails_closed_when_authentication_is_disabled()
    {
        using var factory = CreateFactory(Environments.Production, builder =>
            builder.UseSetting("Authentication:DisableAuthentication", "true"));

        // Building the host runs the composition root, which refuses to start.
        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());
        Assert.Contains("Development", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Host_fails_closed_when_authentication_is_enabled_but_misconfigured()
    {
        using var factory = CreateFactory(Environments.Production, builder =>
        {
            builder.UseSetting("Authentication:DisableAuthentication", "false");
            // No Authority configured -> enabled but misconfigured.
            builder.UseSetting("Authentication:Authority", string.Empty);
        });

        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());
        Assert.Contains("Authority", exception.Message, StringComparison.Ordinal);
    }
}
