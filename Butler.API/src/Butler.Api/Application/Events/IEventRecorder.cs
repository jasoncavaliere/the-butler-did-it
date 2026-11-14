namespace Butler.Api.Application.Events;

/// <summary>
/// Records one usage event (#122) into the household's <c>Events</c> partition,
/// stamped with the injected clock.
/// </summary>
public interface IEventRecorder
{
    /// <summary>
    /// Records the event. Throws <see cref="ArgumentException"/> for an unknown
    /// type, and lets a storage failure propagate.
    /// </summary>
    Task RecordAsync(
        string householdId,
        string type,
        string? personId = null,
        string? choreId = null,
        string? weekIso = null,
        string? itemId = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Best-effort <see cref="RecordAsync"/>: a failure (other than cancellation)
    /// is logged as a warning and reported as <c>false</c>, so a usage event can
    /// never fail the user action it describes.
    /// </summary>
    Task<bool> TryRecordAsync(
        string householdId,
        string type,
        string? personId = null,
        string? choreId = null,
        string? weekIso = null,
        string? itemId = null,
        CancellationToken cancellationToken = default);
}
