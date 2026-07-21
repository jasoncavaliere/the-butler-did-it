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

        // The scheme that satisfies the Organizer policy: the dev-organizer bypass
        // in Development, JWT bearer against Entra External ID otherwise.
        var organizerScheme = disableAuthentication
            ? OrganizerAuthorization.DevScheme
            : JwtBearerDefaults.AuthenticationScheme;

        // The default is a forwarding scheme (T1/T5): a request presenting a hub
        // device token is authenticated by the device scheme, one presenting a
        // participant session header by the participant scheme - so either is
        // authenticated-but-forbidden (403), never a silent 401 - while every other
        // request falls through to the organizer scheme. The Organizer policy
        // therefore needs no explicit scheme list and still fails closed for a
        // device token or a participant session.
        var authBuilder = services.AddAuthentication(options =>
            options.DefaultScheme = ParticipantSession.ForwardScheme);

        authBuilder.AddPolicyScheme(
            ParticipantSession.ForwardScheme,
            ParticipantSession.ForwardScheme,
            forward => forward.ForwardDefaultSelector = context =>
            {
                if (context.Request.Headers.ContainsKey(DeviceToken.HeaderName))
                {
                    return DeviceToken.SchemeName;
                }

                return context.Request.Headers.ContainsKey(ParticipantSession.HeaderName)
                    ? ParticipantSession.SchemeName
                    : organizerScheme;
            });

        // Tap-to-claim participant sessions (no password, no organizer authority).
        authBuilder.AddScheme<AuthenticationSchemeOptions, ParticipantSessionAuthenticationHandler>(
            ParticipantSession.SchemeName,
            configureOptions: null);

        // Paired hub device tokens (T5): long-lived, household-scoped, no organizer
        // authority - reads and completion writes only, never organizer actions.
        authBuilder.AddScheme<AuthenticationSchemeOptions, HubDeviceAuthenticationHandler>(
            DeviceToken.SchemeName,
            configureOptions: null);

        if (disableAuthentication)
        {
            authBuilder.AddScheme<AuthenticationSchemeOptions, DevOrganizerAuthenticationHandler>(
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

            authBuilder.AddJwtBearer(jwt =>
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
            })
            // Organizer OR paired hub device (C3): RequireRole with two roles is
            // OR semantics, so an organizer JWT (or the dev organizer) and a hub
            // device token both satisfy it, while a participant session - which
            // carries neither role - is authenticated-but-forbidden (403).
            .AddPolicy(OrganizerAuthorization.OrganizerOrHubDevicePolicyName, policy =>
            {
                policy.RequireAuthenticatedUser();
                policy.RequireRole(
                    OrganizerAuthorization.OrganizerRole,
                    OrganizerAuthorization.HubDeviceRole);
            });

        return services;
    }
}
