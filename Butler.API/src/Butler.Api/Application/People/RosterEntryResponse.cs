namespace Butler.Api.Application.People;

/// <summary>
/// One claimable person on the tap-to-claim roster (T1). This is the trimmed,
/// unauthenticated projection the hub renders as a name tile: it carries only
/// what a tile needs and never an organizer-only field (for example
/// <c>OrganizerObjectId</c>) nor the concurrency <c>ETag</c> or role, which are
/// the organizer CRUD contract's concern (the single-person read still returns
/// the full <see cref="PersonResponse"/>).
/// </summary>
/// <param name="PersonId">The person's id, used as the claim target.</param>
/// <param name="DisplayName">The name shown on the tile.</param>
/// <param name="ClaimColor">The colour a claimed tile glows in; <c>null</c> until chosen.</param>
/// <param name="IsChild">Whether the person is a child (drives age-gated eligibility).</param>
public sealed record RosterEntryResponse(
    string PersonId,
    string DisplayName,
    string? ClaimColor,
    bool IsChild);
