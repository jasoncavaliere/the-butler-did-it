using Butler.Api.Domain.System;

namespace Butler.Api.Infrastructure.System;

/// <summary>
/// Infrastructure boundary for the System feature. In later features this is
/// where Azure-backed repositories live (behind interfaces); here it stands in
/// for that role by reporting service health, so the full layered path
/// (Handler -&gt; Infrastructure -&gt; Domain) is exercised by the reference slice.
/// </summary>
public interface ISystemStatusProvider
{
    /// <summary>Returns the current health of the service.</summary>
    SystemStatus GetStatus();
}
