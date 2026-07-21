using System.Security.Claims;
using System.Text.Encodings.Web;
using Butler.Api.Application.Auth;
using Butler.Api.Application.HubDevices;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Butler.Api.Infrastructure.Auth;

/// <summary>
/// Authenticates a paired hub device (T5). It decodes the
/// <see cref="DeviceToken.HeaderName"/> request header into a principal scoped to
/// a single <c>(householdId, deviceId)</c> pair, carrying the
/// <see cref="OrganizerAuthorization.HubDeviceRole"/> - and deliberately never
/// the organizer role, so the device is authenticated for reads and completion
/// writes yet is forbidden (<c>403</c>) at any <c>Organizer</c>-policy endpoint.
/// A missing or malformed token yields no principal; so does a token for a device
/// that is no longer paired. A successful authenticate refreshes the device's
/// <c>LastSeenUtc</c> through the clock seam.
/// </summary>
public sealed class HubDeviceAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    private readonly IHubDeviceService _devices;

    public HubDeviceAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        IHubDeviceService devices)
        : base(options, logger, encoder)
    {
        ArgumentNullException.ThrowIfNull(devices);
        _devices = devices;
    }

    /// <inheritdoc />
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        // A missing header renders as an empty string, which TryDecode rejects, so
        // there is a single "no valid token" path.
        var token = Request.Headers[DeviceToken.HeaderName].ToString();
        if (!DeviceToken.TryDecode(token, out var householdId, out var deviceId))
        {
            return AuthenticateResult.NoResult();
        }

        // The token is opaque and unsigned; the device row is the source of truth.
        // Touch it: a token for a device that is no longer paired authenticates
        // nobody, and a live one has its LastSeenUtc refreshed from the clock seam.
        var paired = await _devices.TouchAsync(householdId, deviceId).ConfigureAwait(false);
        if (!paired)
        {
            return AuthenticateResult.NoResult();
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, deviceId),
            new Claim(DeviceToken.HouseholdIdClaimType, householdId),
            new Claim(ClaimTypes.Role, OrganizerAuthorization.HubDeviceRole),
        };

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, Scheme.Name);

        return AuthenticateResult.Success(ticket);
    }
}
