using Butler.Api.Application.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ButlerAuthenticationOptions = Butler.Api.Application.Auth.AuthenticationOptions;

namespace Butler.Api.Infrastructure.Auth;

/// <summary>
/// Composition entry point for the organizer authentication seam (Engineering
/// Contract 7.4). Wires JWT bearer validation against Entra External ID plus the
/// <c>Organizer</c> authorization policy, with a Development-only bypass that
/// fails closed everywhere else.
/// </summary>
public static class AuthenticationServiceCollectionExtensions
{
    /// <summary>
    /// Registers organizer authentication and the <c>Organizer</c> policy.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>Authentication:DisableAuthentication</c> resolves to its configured
    /// value, or - when unset - to <c>true</c> only in Development. When disabled,
    /// a dev-organizer scheme is registered so the policy is permissive. When
    /// enabled, JWT bearer validation is wired against the configured authority.
    /// </para>
    /// <para>
    /// Fail-closed (mitigates BRD risk R-1): a non-Development host refuses to
    /// start if authentication is disabled, or if it is enabled but no authority
    /// is configured. Either way the app never serves organizer endpoints open.
    /// </para>
    /// </remarks>
    public static IServiceCollection AddOrganizerAuthentication(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(environment);

        var section = configuration.GetSection(ButlerAuthenticationOptions.SectionName);
        var options = new ButlerAuthenticationOptions();
        section.Bind(options);

        var isDevelopment = environment.IsDevelopment();
        var explicitDisable = section.GetValue<bool?>(nameof(ButlerAuthenticationOptions.DisableAuthentication));
        var disableAuthentication = explicitDisable ?? isDevelopment;

        if (disableAuthentication && !isDevelopment)
        {
            throw new InvalidOperationException(
                "Authentication:DisableAuthentication is only permitted in the Development environment. " +
                $"Refusing to start in '{environment.EnvironmentName}' with authentication disabled (fail closed).");
        }

        if (disableAuthentication)
        {
            services
                .AddAuthentication(OrganizerAuthorization.DevScheme)
                .AddScheme<AuthenticationSchemeOptions, DevOrganizerAuthenticationHandler>(
                    OrganizerAuthorization.DevScheme,
                    configureOptions: null);
        }
        else
        {
            if (string.IsNullOrWhiteSpace(options.Authority))
            {
                throw new InvalidOperationException(
                    "Authentication is enabled but Authentication:Authority is not configured. " +
                    "Refusing to start misconfigured (fail closed).");
            }

            services
                .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                .AddJwtBearer(jwt =>
                {
                    jwt.Authority = options.Authority;
                    jwt.Audience = options.Audience;
                    jwt.TokenValidationParameters.ValidateAudience =
                        !string.IsNullOrWhiteSpace(options.Audience);
                });
        }

        services.AddAuthorizationBuilder()
            .AddPolicy(OrganizerAuthorization.PolicyName, policy =>
            {
                policy.RequireAuthenticatedUser();
                policy.RequireRole(OrganizerAuthorization.OrganizerRole);
            });

        return services;
    }
}
