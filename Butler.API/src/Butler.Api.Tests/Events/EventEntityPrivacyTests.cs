using System.Reflection;
using Butler.Api.Infrastructure.Events;

namespace Butler.Api.Tests.Events;

/// <summary>
/// Criterion (#122 AC12, privacy): the event row carries only ids already in the
/// household model, the event type, and a timestamp. There are zero free-text or
/// name fields, so a usage event can never leak a display name, an utterance or a
/// product name.
/// </summary>
public sealed class EventEntityPrivacyTests
{
    private static readonly string[] AllowedProperties =
    [
        nameof(EventEntity.PartitionKey),
        nameof(EventEntity.RowKey),
        nameof(EventEntity.Timestamp),
        nameof(EventEntity.ETag),
        nameof(EventEntity.Type),
        nameof(EventEntity.OccurredUtc),
        nameof(EventEntity.PersonId),
        nameof(EventEntity.ChoreId),
        nameof(EventEntity.WeekIso),
        nameof(EventEntity.ItemId),
    ];

    private static readonly string[] FreeTextMarkers =
    [
        "Name", "Text", "Utterance", "Note", "Title", "Description", "Message", "Term", "Label",
    ];

    private static string[] PublicPropertyNames() =>
        typeof(EventEntity)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(property => property.Name)
            .ToArray();

    [Fact]
    public void Event_entity_carries_only_household_ids_type_and_timestamp()
    {
        Assert.Equal(
            AllowedProperties.Order(StringComparer.Ordinal),
            PublicPropertyNames().Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Event_entity_has_no_free_text_or_name_fields()
    {
        var offending = PublicPropertyNames()
            .Where(name => FreeTextMarkers.Any(
                marker => name.Contains(marker, StringComparison.OrdinalIgnoreCase)))
            .ToArray();

        Assert.Empty(offending);
    }
}
