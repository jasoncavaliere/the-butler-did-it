namespace Butler.Api.Application.People;

/// <summary>
/// The result of claiming a person at the hub (T1): a lightweight participant
/// session scoped to exactly <c>(householdId, personId)</c>. The caller keeps
/// <see cref="Token"/> and presents it on the
/// <see cref="Butler.Api.Application.Auth.ParticipantSession.HeaderName"/> header
/// for completion writes (Epic 40 C4 attributes a <c>ChoreCompletion</c> to
/// <see cref="PersonId"/>); the identity fields are echoed so the hub can render
/// the claimed tile without a second read. The session grants no organizer
/// authority.
/// </summary>
/// <param name="HouseholdId">The household the session is scoped to.</param>
/// <param name="PersonId">The claimed person - the active participant for completions.</param>
/// <param name="DisplayName">The claimed person's display name.</param>
/// <param name="ClaimColor">The colour the claimed tile glows in; <c>null</c> until chosen.</param>
/// <param name="IsChild">Whether the claimed person is a child.</param>
/// <param name="Token">The opaque participant session token to replay on later requests.</param>
public sealed record ParticipantSessionResponse(
    string HouseholdId,
    string PersonId,
    string DisplayName,
    string? ClaimColor,
    bool IsChild,
    string Token);
