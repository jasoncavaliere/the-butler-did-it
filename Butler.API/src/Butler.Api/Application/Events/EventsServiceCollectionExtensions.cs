using Butler.Api.Infrastructure.Events;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.Events;

/// <summary>
/// Composition entry point for usage events (#122, Engineering Contract 7.2).
/// Registers the <c>Events</c> table on the shared F3 storage seam, the
/// append-only repository, the recorder, and the injected clock.
/// </summary>
public static class EventsServiceCollectionExtensions
{
    /// <summary>Registers everything the Events feature needs.</summary>
    public static IServiceCollection AddEventsFeature(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The table this feature owns on the shared F3 seam (7.3).
        services.AddTableRepository<EventEntity>("Events");

        services.TryAddSingleton<IEventRepository, TableEventRepository>();
        services.TryAddScoped<IEventRecorder, EventRecorder>();
        services.TryAddSingleton(TimeProvider.System);

        return services;
    }
}
