using System.Buffers.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Butler.Api.Application.Auth;

/// <summary>
/// The tap-to-claim participant session (T1 / Engineering Contract 7.4). Claiming
/// a person at the hub issues an opaque token that encodes exactly
/// <c>(householdId, personId)</c> and nothing more; it carries the
/// <see cref="OrganizerAuthorization.ParticipantRole"/> and never the organizer
/// role, so it can identify who is acting for a completion write (the
/// <c>personId</c> Epic 40 C4 attributes a <c>ChoreCompletion</c> to) yet can
/// never satisfy the <c>Organizer</c> policy.
/// </summary>
/// <remarks>
/// <para>
/// <b>Contract for consumers (C4):</b> present the token from a claim response on
/// the <see cref="HeaderName"/> request header. The participant authentication
/// handler decodes it into a principal whose
/// <see cref="System.Security.Claims.ClaimTypes.NameIdentifier"/> is the
/// <c>personId</c> and which also carries the household on
/// <see cref="HouseholdIdClaimType"/>; a completion endpoint reads
/// <c>User</c> with no organizer JWT required.
/// </para>
/// <para>
/// The token is intentionally opaque and unsigned. Claiming is itself
/// unauthenticated (Decision D-3 trusts whoever is at the hub) and no money moves
/// in v1 (Decision D-8), so a forged identity buys nothing: the only privileged
/// surface is the <c>Organizer</c> policy, which this session can never reach by
/// construction (it never holds the organizer role).
/// </para>
/// </remarks>
public static class ParticipantSession
{
    /// <summary>The authentication scheme that decodes a participant session.</summary>
    public const string SchemeName = "ParticipantSession";

    /// <summary>
    /// The forwarding scheme wired as the default: it routes a request carrying
    /// <see cref="HeaderName"/> to <see cref="SchemeName"/> and every other request
    /// to the organizer scheme, so a participant session is authenticated (and thus
    /// forbidden, not merely unauthenticated) at an organizer-only endpoint.
    /// </summary>
    public const string ForwardScheme = "ButlerDefault";

    /// <summary>The request header a caller presents its participant session on.</summary>
    public const string HeaderName = "X-Participant-Session";

    /// <summary>The claim type carrying the household a participant session is scoped to.</summary>
    public const string HouseholdIdClaimType = "butler:household_id";

    /// <summary>
    /// Encodes a participant session token scoped to exactly
    /// <paramref name="householdId"/> and <paramref name="personId"/>.
    /// </summary>
    public static string Encode(string householdId, string personId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(personId);

        var payload = JsonSerializer.SerializeToUtf8Bytes(new TokenPayload(householdId, personId));
        return Base64Url.EncodeToString(payload);
    }

    /// <summary>
    /// Attempts to decode a participant session token back into the
    /// <c>(householdId, personId)</c> pair it was issued for. Returns <c>false</c>
    /// (and empty outputs) for a null, malformed, or incomplete token.
    /// </summary>
    public static bool TryDecode(string? token, out string householdId, out string personId)
    {
        householdId = string.Empty;
        personId = string.Empty;

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
                string.IsNullOrWhiteSpace(payload.PersonId))
            {
                return false;
            }

            householdId = payload.HouseholdId;
            personId = payload.PersonId;
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
        [property: JsonPropertyName("p")] string PersonId);
}
