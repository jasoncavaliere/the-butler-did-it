using Butler.Api.Infrastructure.System;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.System;

/// <summary>
/// Composition entry point for the System feature. Every feature exposes an
/// <c>Add&lt;Feature&gt;Feature()</c> extension so <c>Program.cs</c> wires it
/// with a single call. To add a feature: create <c>Application/&lt;Feature&gt;/</c>
/// (+ <c>Infrastructure/&lt;Feature&gt;/</c>), expose <c>Add&lt;Feature&gt;Feature()</c>,
/// and register it here.
/// </summary>
public static class SystemServiceCollectionExtensions
{
    /// <summary>Registers everything the System feature needs.</summary>
    public static IServiceCollection AddSystemFeature(this IServiceCollection services)
    {
        // Infrastructure: the status provider stands in for a repository.
        services.TryAddSingleton<ISystemStatusProvider, SystemStatusProvider>();

        // A clock is injected so handlers stay deterministically testable
        // (Section 7.5). MediatR handlers themselves are discovered by the
        // assembly scan in Program.cs.
        services.TryAddSingleton(TimeProvider.System);

        return services;
    }
}
