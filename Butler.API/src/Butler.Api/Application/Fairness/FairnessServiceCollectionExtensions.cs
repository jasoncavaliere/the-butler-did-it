using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.Fairness;

/// <summary>
/// Composition entry point for the Fairness feature (Engineering Contract 7.2):
/// the read-only C6 contribution-balance view. It registers only the application
/// service; the tables it reads - <c>ChoreCompletions</c> (Assignments feature)
/// and <c>People</c> - and the <c>Households</c> aggregate are owned and
/// registered by their own features, and the injected clock is shared. This is a
/// pure read model, so it adds no repository or table of its own.
/// </summary>
public static class FairnessServiceCollectionExtensions
{
    /// <summary>Registers everything the Fairness feature needs.</summary>
    public static IServiceCollection AddFairnessFeature(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The fetch -> aggregate read model. Scoped, like the other application
        // services, since it orchestrates per-request repository reads.
        services.TryAddScoped<IFairnessService, FairnessService>();

        // Injected clock so the trailing window stays deterministically testable;
        // shared with the other features via TryAdd (7.5).
        services.TryAddSingleton(TimeProvider.System);

        return services;
    }
}
