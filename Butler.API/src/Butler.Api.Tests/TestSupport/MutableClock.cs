namespace Butler.Api.Tests.TestSupport;

/// <summary>
/// A <see cref="TimeProvider"/> test double whose "now" can be set explicitly, so
/// a test can prove that time-stamped writes (for example a hub device's
/// <c>LastSeenUtc</c>) come from the injected clock seam rather than
/// <c>DateTime.Now</c>. Register it in place of <see cref="TimeProvider.System"/>
/// and advance it between requests to observe the difference.
/// </summary>
public sealed class MutableClock : TimeProvider
{
    private DateTimeOffset _utcNow;

    public MutableClock(DateTimeOffset start) => _utcNow = start;

    /// <summary>Sets the value the next <see cref="GetUtcNow"/> calls return.</summary>
    public void Set(DateTimeOffset utcNow) => _utcNow = utcNow;

    /// <inheritdoc />
    public override DateTimeOffset GetUtcNow() => _utcNow;
}
