using Azure;
using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.HubDevices;

/// <summary>
/// The <c>HubDevices</c> table row (Engineering Contract 7.3): a tablet paired as
/// a household's long-lived hub device (the "The Hub" persona). Scoped to the
/// household by <c>PartitionKey = householdId</c> with a per-device
/// <c>RowKey = deviceId</c>. Pairing (T5) writes this row; the device token the
/// pair returns is scoped to exactly this <c>(householdId, deviceId)</c>.
/// </summary>
public sealed class HubDeviceEntity : ITableEntity
{
    /// <summary>The <c>householdId</c> (Table partition key).</summary>
    public string PartitionKey { get; set; } = string.Empty;

    /// <summary>The <c>deviceId</c> (Table row key).</summary>
    public string RowKey { get; set; } = string.Empty;

    /// <summary>Service-assigned last-write timestamp.</summary>
    public DateTimeOffset? Timestamp { get; set; }

    /// <summary>Optimistic-concurrency version stamp.</summary>
    public ETag ETag { get; set; }

    /// <summary>Human-readable name for the paired tablet (for example "Kitchen hub").</summary>
    public string DeviceName { get; set; } = string.Empty;

    /// <summary>When the device was paired, from the injected clock.</summary>
    public DateTimeOffset PairedUtc { get; set; }

    /// <summary>
    /// When the device token was last presented, from the injected clock. Refreshed
    /// every time the paired device authenticates so the organizer can see whether a
    /// tablet is still alive.
    /// </summary>
    public DateTimeOffset LastSeenUtc { get; set; }
}
