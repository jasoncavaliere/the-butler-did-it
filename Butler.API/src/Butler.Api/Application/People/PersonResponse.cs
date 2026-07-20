namespace Butler.Api.Application.People;

/// <summary>
/// A person as returned to callers. Carries the server-generated
/// <see cref="PersonId"/> and the current <see cref="ETag"/> so a later mutation
/// can supply it as <c>If-Match</c> (Engineering Contract 7.3). The
/// organizer-binding object id is intentionally not projected: it is an internal
/// auth detail, not roster data.
/// </summary>
/// <param name="PersonId">The person's id (their row key within the household partition).</param>
/// <param name="DisplayName">The person's display name shown on the hub.</param>
/// <param name="Role">The person's role: <c>Organizer</c> or <c>Participant</c>.</param>
/// <param name="IsChild">Whether the person is a child (drives age-gated eligibility).</param>
/// <param name="ClaimColor">The colour a claimed tile glows in; <c>null</c> until chosen.</param>
/// <param name="ETag">The current optimistic-concurrency version stamp.</param>
public sealed record PersonResponse(
    string PersonId,
    string DisplayName,
    string Role,
    bool IsChild,
    string? ClaimColor,
    string ETag);
