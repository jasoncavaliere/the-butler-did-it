using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.Hosting;
using Microsoft.Extensions.Hosting;
using ButlerAuthenticationOptions = Butler.Api.Application.Auth.AuthenticationOptions;

namespace Butler.Api.Infrastructure.Auth;

/// <summary>Which scheme satisfies the <c>Organizer</c> policy.</summary>
public enum OrganizerAuthMode
{
    /// <summary>Every request is the dev organizer (Development default; explicit in Demo).</summary>
    DevBypass,

    /// <summary>The local demo PIN organizer (#105): Development or Demo only.</summary>
    Pin,

    /// <summary>JWT bearer against Entra External ID.</summary>
    EntraJwt,
}

/// <summary>
/// Pure resolution of the organizer authentication mode from the environment and
/// the <c>Authentication</c> settings, with the fail-closed guards (BRD risk R-1,
/// #105 AC13). It reads no configuration itself so every branch is unit-testable.
/// </summary>
public static class OrganizerAuthModeResolver
{
    private const int MinPinLength = 4;
    private const int MaxPinLength = 6;

    /// <summary>
    /// Resolves the mode. Order: parse the provider (unknown throws); the PIN
    /// provider outside Development/Demo throws; the bypass resolves to its
    /// explicit value or, when unset, to Development without the PIN provider;
    /// the bypass outside Development/Demo throws.
    /// </summary>
    /// <param name="environment">The host environment.</param>
    /// <param name="provider">The <c>Authentication:Provider</c> value (null means Entra).</param>
    /// <param name="explicitDisable">The explicit <c>Authentication:DisableAuthentication</c>, when set.</param>
    public static OrganizerAuthMode Resolve(IHostEnvironment environment, string? provider, bool? explicitDisable)
    {
        ArgumentNullException.ThrowIfNull(environment);

        var isPin = IsPinProvider(provider);
        if (isPin && !environment.IsDevelopmentOrDemo())
        {
            throw new InvalidOperationException(
                $"{ButlerAuthenticationOptions.ProviderKey}={ButlerAuthenticationOptions.PinProvider} is only permitted " +
                "in the Development or Demo environment. " +
                $"Refusing to start in '{environment.EnvironmentName}' with the demo PIN organizer (fail closed).");
        }

        var disableAuthentication = explicitDisable ?? (environment.IsDevelopment() && !isPin);
        if (disableAuthentication && !environment.IsDevelopmentOrDemo())
        {
            throw new InvalidOperationException(
                "Authentication:DisableAuthentication is only permitted in the Development or Demo environment. " +
                $"Refusing to start in '{environment.EnvironmentName}' with authentication disabled (fail closed).");
        }

        if (disableAuthentication)
        {
            return OrganizerAuthMode.DevBypass;
        }

        return isPin ? OrganizerAuthMode.Pin : OrganizerAuthMode.EntraJwt;
    }

    /// <summary>
    /// Returns <paramref name="pin"/> when it is 4-6 ASCII digits; otherwise throws
    /// an exception naming <see cref="PinOrganizerOptions.PinConfigurationKey"/>
    /// (never the value).
    /// </summary>
    /// <param name="pin">The configured PIN.</param>
    public static string ValidatePin(string? pin)
    {
        if (pin is null
            || pin.Length < MinPinLength
            || pin.Length > MaxPinLength
            || !pin.All(char.IsAsciiDigit))
        {
            throw new InvalidOperationException(
                $"{ButlerAuthenticationOptions.ProviderKey} is {ButlerAuthenticationOptions.PinProvider} but " +
                $"{PinOrganizerOptions.PinConfigurationKey} is not set to a 4-6 digit PIN. " +
                "Set it in the environment (the demo stack reads demo/.env). " +
                "Refusing to start misconfigured (fail closed).");
        }

        return pin;
    }

    private static bool IsPinProvider(string? provider)
    {
        if (string.IsNullOrWhiteSpace(provider)
            || string.Equals(provider, ButlerAuthenticationOptions.EntraProvider, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (string.Equals(provider, ButlerAuthenticationOptions.PinProvider, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        throw new InvalidOperationException(
            $"{ButlerAuthenticationOptions.ProviderKey} '{provider}' is not supported. " +
            $"Use '{ButlerAuthenticationOptions.EntraProvider}' or '{ButlerAuthenticationOptions.PinProvider}'. " +
            "Refusing to start misconfigured (fail closed).");
    }
}
