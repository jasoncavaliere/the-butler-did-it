using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.Insights;

/// <summary>
/// Composition entry point for the Insights feature (Engineering Contract 7.2):
/// the organizer's read-only insights view (#123). It registers only the
/// application service; the tables it reads - <c>ChoreCompletions</c>,
/// <c>People</c>, <c>Events</c>, <c>Carts</c> and <c>Households</c> - are owned
/// and registered by their own features, and the injected clock is shared. This
/// is a pure read model, so it adds no repository or table of its own.
/// </summary>
public static class InsightsServiceCollectionExtensions
{
    /// <summary>Registers everything the Insights feature needs.</summary>
    public static IServiceCollection AddInsightsFeature(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Scoped, like the other application services, since it orchestrates
        // per-request repository reads.
        services.TryAddScoped<IInsightsService, InsightsService>();

        // Injected clock so the window stays deterministically testable; shared
        // with the other features via TryAdd (7.5).
        services.TryAddSingleton(TimeProvider.System);

        return services;
    }
}
