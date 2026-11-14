using Butler.Api.Application.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using ButlerAuthenticationOptions = Butler.Api.Application.Auth.AuthenticationOptions;

namespace Butler.Api.Infrastructure.Auth;

/// <summary>
/// Composition entry point for the organizer authentication seam (Engineering
/// Contract 7.4). Wires one of three organizer modes plus the <c>Organizer</c>
/// authorization policies: JWT bearer against Entra External ID, the local demo
/// PIN organizer (#105, Development and Demo only), or a bypass that defaults on
/// only in Development, is permitted in Demo when set explicitly, and fails
/// closed everywhere else.
/// </summary>
public static class AuthenticationServiceCollectionExtensions
{
    /// <summary>
    /// Registers organizer authentication and the <c>Organizer</c> policy.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The mode comes from <see cref="OrganizerAuthModeResolver"/>:
    /// <c>Authentication:DisableAuthentication</c> resolves to its configured
    /// value, or - when unset - to <c>true</c> only in Development without the PIN
    /// provider, and the bypass wins when on. Otherwise
    /// <c>Authentication:Provider</c> picks <c>Entra</c> (default, JWT bearer) or
    /// <c>Pin</c> (the demo PIN organizer; <c>appsettings.Demo.json</c> sets it).
    /// </para>
    /// <para>
    /// Fail-closed (mitigates BRD risk R-1): a host outside Development and Demo
    /// refuses to start with the bypass on or with the PIN provider; the PIN
    /// provider refuses to start without a 4-6 digit <c>BUTLER_DEMO_PIN</c> or
    /// with non-positive <c>Authentication:Pin:*</c> values; and the Entra mode
    /// refuses to start without an authority. Either way the app never serves
    /// organizer endpoints open.
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

        var explicitDisable = section.GetValue<bool?>(nameof(ButlerAuthenticationOptions.DisableAuthentication));
        var mode = OrganizerAuthModeResolver.Resolve(environment, options.Provider, explicitDisable);

        // The scheme that satisfies the Organizer policy.
        var organizerScheme = mode switch
        {
            OrganizerAuthMode.DevBypass => OrganizerAuthorization.DevScheme,
            OrganizerAuthMode.Pin => OrganizerAuthorization.PinScheme,
            _ => JwtBearerDefaults.AuthenticationScheme,
        };

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

        if (mode == OrganizerAuthMode.DevBypass)
        {
            authBuilder.AddScheme<AuthenticationSchemeOptions, DevOrganizerAuthenticationHandler>(
                OrganizerAuthorization.DevScheme,
                configureOptions: null);
        }
        else if (mode == OrganizerAuthMode.Pin)
        {
            AddPinOrganizer(services, authBuilder, configuration);
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

        // /auth/pin/* exists only in the PIN mode; 404 under the bypass or Entra.
        // The PIN command handlers stay resolvable there through a refusing store.
        if (mode != OrganizerAuthMode.Pin)
        {
            services.TryAddSingleton<IPinOrganizerSessions, DisabledPinOrganizerSessions>();
        }

        services.AddMvcCore().ConfigureApplicationPartManager(manager =>
            manager.FeatureProviders.Add(new PinSignInControllerFeatureProvider(mode)));

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

    // The demo PIN organizer (#105): the PIN comes from BUTLER_DEMO_PIN (an
    // environment variable, never a committed file) and the tuning from
    // Authentication:Pin, both checked now so a bad value fails startup. The
    // clock is resolved lazily so a test's TimeProvider swap reaches the store.
    private static void AddPinOrganizer(
        IServiceCollection services,
        AuthenticationBuilder authBuilder,
        IConfiguration configuration)
    {
        var pin = OrganizerAuthModeResolver.ValidatePin(configuration[PinOrganizerOptions.PinConfigurationKey]);

        var pinOptions = new PinOrganizerOptions();
        configuration.GetSection(PinOrganizerOptions.SectionName).Bind(pinOptions);
        pinOptions.Validate();

        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton(pinOptions);
        services.AddSingleton<IPinOrganizerSessions>(provider =>
            new PinOrganizerSessions(pin, pinOptions, provider.GetRequiredService<TimeProvider>()));

        authBuilder.AddScheme<AuthenticationSchemeOptions, PinOrganizerAuthenticationHandler>(
            OrganizerAuthorization.PinScheme,
            configureOptions: null);
    }
}
