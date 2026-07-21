using System.Buffers.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Butler.Api.Application.Auth;

/// <summary>
/// The hub device token (T5 / Engineering Contract 7.4). Pairing a tablet at the
/// hub issues a long-lived, opaque token that encodes exactly
/// <c>(householdId, deviceId)</c> and nothing more; it carries the
/// <see cref="OrganizerAuthorization.HubDeviceRole"/> and never the organizer
/// role, so the paired device can read the household and record completions yet
/// can never satisfy the <c>Organizer</c> policy.
/// </summary>
/// <remarks>
/// <para>
/// <b>Contract for consumers:</b> present the token from a pair response on the
/// <see cref="HeaderName"/> request header. The hub device authentication handler
/// decodes it, verifies the device row still exists, stamps its
/// <c>LastSeenUtc</c> through the clock seam, and produces a principal whose
/// <see cref="System.Security.Claims.ClaimTypes.NameIdentifier"/> is the
/// <c>deviceId</c> and which carries the household on
/// <see cref="HouseholdIdClaimType"/>.
/// </para>
/// <para>
/// The token is intentionally opaque and unsigned, mirroring the participant
/// session (T1). The device credential is deliberately weaker than an organizer
/// JWT: no money moves in v1 (Decision D-8) and the only privileged surface is
/// the <c>Organizer</c> policy, which this token can never reach by construction
/// (it never holds the organizer role). Its blast radius is reads + completions
/// for the single household it is scoped to.
/// </para>
/// </remarks>
public static class DeviceToken
{
    /// <summary>The authentication scheme that decodes a hub device token.</summary>
    public const string SchemeName = "HubDevice";

    /// <summary>The request header a hub device presents its token on.</summary>
    public const string HeaderName = "X-Device-Token";

    /// <summary>The claim type carrying the household a device token is scoped to.</summary>
    public const string HouseholdIdClaimType = "butler:household_id";

    /// <summary>The claim type carrying the paired device's id.</summary>
    public const string DeviceIdClaimType = "butler:device_id";

    /// <summary>
    /// Encodes a hub device token scoped to exactly <paramref name="householdId"/>
    /// and <paramref name="deviceId"/>.
    /// </summary>
    public static string Encode(string householdId, string deviceId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);

        var payload = JsonSerializer.SerializeToUtf8Bytes(new TokenPayload(householdId, deviceId));
        return Base64Url.EncodeToString(payload);
    }

    /// <summary>
    /// Attempts to decode a hub device token back into the
    /// <c>(householdId, deviceId)</c> pair it was issued for. Returns <c>false</c>
    /// (and empty outputs) for a null, malformed, or incomplete token.
    /// </summary>
    public static bool TryDecode(string? token, out string householdId, out string deviceId)
    {
        householdId = string.Empty;
        deviceId = string.Empty;

        if (string.IsNullOrWhiteSpace(token))
        {
            return false;
        }

        try
        {
            var bytes = Base64Url.DecodeFromChars(token);
            var payload = JsonSerializer.Deserialize<TokenPayload>(bytes);
            if (payload is null ||
                string.IsNullOrWhiteSpace(payload.HouseholdId) ||
                string.IsNullOrWhiteSpace(payload.DeviceId))
            {
                return false;
            }

            householdId = payload.HouseholdId;
            deviceId = payload.DeviceId;
            return true;
        }
        catch (FormatException)
        {
            // Not valid base64url.
            return false;
        }
        catch (JsonException)
        {
            // Valid base64url but not the expected payload shape.
            return false;
        }
    }

    // Compact wire shape for the opaque token; property names are single letters
    // so the encoded token stays short.
    private sealed record TokenPayload(
        [property: JsonPropertyName("h")] string HouseholdId,
        [property: JsonPropertyName("d")] string DeviceId);
}
