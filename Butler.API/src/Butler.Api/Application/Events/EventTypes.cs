namespace Butler.Api.Application.Events;

/// <summary>
/// The usage event types (#122). Five are recorded server-side by the MediatR
/// handlers; only <see cref="HubGlanced"/> may be posted by a client.
/// </summary>
public static class EventTypes
{
    /// <summary>A chore was completed (recorded by the complete handler).</summary>
    public const string ChoreCompleted = "chore-completed";

    /// <summary>A chore completion was undone (recorded by the undo handler).</summary>
    public const string ChoreUndone = "chore-undone";

    /// <summary>Capture added an item to a cart (recorded by the capture handler).</summary>
    public const string CartItemAdded = "cart-item-added";

    /// <summary>A cart was confirmed (recorded by the confirm handler).</summary>
    public const string CartConfirmed = "cart-confirmed";

    /// <summary>A person was claimed at the hub (recorded by the claim handler).</summary>
    public const string ParticipantClaimed = "participant-claimed";

    /// <summary>The hub was viewed (the only client-posted type).</summary>
    public const string HubGlanced = "hub-glanced";

    private static readonly string[] All =
    [
        ChoreCompleted,
        ChoreUndone,
        CartItemAdded,
        CartConfirmed,
        ParticipantClaimed,
        HubGlanced,
    ];

    /// <summary>True when <paramref name="type"/> is one of the known types (ordinal).</summary>
    public static bool IsKnown(string? type) =>
        All.Any(known => string.Equals(known, type, StringComparison.Ordinal));

    /// <summary>
    /// True only for <see cref="HubGlanced"/> (ordinal, case-sensitive). Every
    /// other type is recorded server-side and a client may not forge it.
    /// </summary>
    public static bool IsClientAllowed(string? type) =>
        string.Equals(HubGlanced, type, StringComparison.Ordinal);
}
