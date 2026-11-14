using Butler.Api.Domain.System;

namespace Butler.Api.Infrastructure.System;

/// <summary>
/// Reports the build the API is running (#126). The default implementation
/// reads the <c>AssemblyMetadata</c> the build stamps into the API assembly.
/// </summary>
public interface IBuildVersionProvider
{
    /// <summary>Returns the running build's SHA and build time.</summary>
    BuildVersion GetVersion();
}
