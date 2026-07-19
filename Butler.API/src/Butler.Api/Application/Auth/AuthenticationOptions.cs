namespace Butler.Api.Application.Auth;

/// <summary>
/// Configuration for the organizer authentication seam (Engineering Contract
/// 7.4), bound from the <c>Authentication</c> section. Only the organizer
/// authenticates; participants and the hub device never do (Epic 30).
/// </summary>
/// <remarks>
/// None of these values are secrets - <see cref="Authority"/> and
/// <see cref="Audience"/> are public Entra External ID identifiers, so they are
/// safe to commit as (empty) placeholders and supply per environment.
/// </remarks>
public sealed class AuthenticationOptions
{
    /// <summary>Configuration section this binds from.</summary>
    public const string SectionName = "Authentication";

    /// <summary>
    /// When <c>true</c>, authentication is bypassed: the <c>Organizer</c> policy
    /// is satisfied by a deterministic dev-organizer principal so local runs and
    /// tests need no live tenant. Defaults to <c>true</c> in Development and is
    /// refused (fail closed) in every other environment. Never set this outside
    /// Development.
    /// </summary>
    public bool DisableAuthentication { get; set; }

    /// <summary>
    /// The Entra External ID authority (issuer) that mints organizer tokens, for
    /// example <c>https://&lt;tenant&gt;.ciamlogin.com/&lt;tenant-id&gt;/v2.0</c>.
    /// Required whenever authentication is enabled.
    /// </summary>
    public string? Authority { get; set; }

    /// <summary>
    /// The expected audience (the API's application/client id) tokens must carry.
    /// Optional; when unset the audience is not validated.
    /// </summary>
    public string? Audience { get; set; }
}
