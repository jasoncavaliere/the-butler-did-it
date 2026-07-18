using Butler.Api.Domain.System;

namespace Butler.Api.Infrastructure.System;

/// <summary>
/// Default <see cref="ISystemStatusProvider"/>: the service is healthy whenever
/// it can answer, so this simply returns <see cref="SystemStatus.Healthy"/>.
/// </summary>
public sealed class SystemStatusProvider : ISystemStatusProvider
{
    public SystemStatus GetStatus() => SystemStatus.Healthy;
}
