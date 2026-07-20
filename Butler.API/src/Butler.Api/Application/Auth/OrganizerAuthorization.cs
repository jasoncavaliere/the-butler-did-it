namespace Butler.Api.Application.Auth;

/// <summary>
/// Names and identifiers for the organizer authorization seam (Engineering
/// Contract 7.4). Endpoints that mutate household structure, pair devices, or
/// confirm a cart carry <c>[Authorize(Policy = OrganizerAuthorization.PolicyName)]</c>.
/// </summary>
public static class OrganizerAuthorization
{
    /// <summary>The authorization policy an organizer-only endpoint requires.</summary>
    public const string PolicyName = "Organizer";

    /// <summary>The role claim value that marks a principal as an organizer.</summary>
    public const string OrganizerRole = "Organizer";

    /// <summary>The role value for a non-organizer household member (tap-to-claim participant).</summary>
    public const string ParticipantRole = "Participant";

    /// <summary>
    /// The role value for a paired hub device (T5). Like the participant role it
    /// deliberately never satisfies the <c>Organizer</c> policy: a device token
    /// permits household reads and completion writes but no organizer actions.
    /// </summary>
    public const string HubDeviceRole = "HubDevice";

    /// <summary>
    /// The authentication scheme used when authentication is disabled
    /// (Development only): every request is authenticated as the dev organizer.
    /// </summary>
    public const string DevScheme = "DevOrganizer";

    /// <summary>
    /// Stable subject (object id) of the injected dev organizer, so dev-mode
    /// behaviour is deterministic across runs.
    /// </summary>
    public const string DevOrganizerSubject = "dev-organizer-00000000-0000-0000-0000-000000000000";

    /// <summary>Display name of the injected dev organizer.</summary>
    public const string DevOrganizerName = "Development Organizer";
}
