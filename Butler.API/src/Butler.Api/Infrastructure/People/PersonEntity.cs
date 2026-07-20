using Azure;
using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.People;

/// <summary>
/// The <c>People</c> table row (Engineering Contract 7.3): a member of a
/// household's roster, scoped to the household by <c>PartitionKey = householdId</c>
/// with a per-person <c>RowKey = personId</c>. H1 creates only the organizer's
/// row so the household is never left without an owner; H3 adds the full
/// organizer-managed roster CRUD on top of this same table.
/// </summary>
public sealed class PersonEntity : ITableEntity
{
    /// <summary>The <c>householdId</c> (Table partition key).</summary>
    public string PartitionKey { get; set; } = string.Empty;

    /// <summary>The <c>personId</c> (Table row key).</summary>
    public string RowKey { get; set; } = string.Empty;

    /// <summary>Service-assigned last-write timestamp.</summary>
    public DateTimeOffset? Timestamp { get; set; }

    /// <summary>Optimistic-concurrency version stamp.</summary>
    public ETag ETag { get; set; }

    /// <summary>The person's display name shown on the hub.</summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>The person's role: <c>Organizer</c> or <c>Participant</c>.</summary>
    public string Role { get; set; } = string.Empty;

    /// <summary>Whether the person is a child (drives age-gated chore eligibility).</summary>
    public bool IsChild { get; set; }

    /// <summary>The colour a claimed tile glows in; unset until chosen.</summary>
    public string? ClaimColor { get; set; }

    /// <summary>
    /// Object id binding this row to an authenticated organizer. Set only on
    /// organizer rows; <c>null</c> for tap-to-claim participants.
    /// </summary>
    public string? OrganizerObjectId { get; set; }
}
