using Butler.Api.Infrastructure.HubDevices;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.HubDevices;

/// <summary>
/// Composition entry point for the HubDevices feature (Engineering Contract 7.2).
/// Registers the <c>HubDevices</c> table on the shared F3 storage seam, the
/// repository, the application service, and the clock; <c>Program.cs</c> wires it
/// with a single <see cref="AddHubDevicesFeature"/> call.
/// </summary>
public static class HubDevicesServiceCollectionExtensions
{
    /// <summary>Registers everything the HubDevices feature needs.</summary>
    public static IServiceCollection AddHubDevicesFeature(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The table this feature owns on the shared F3 seam (7.3).
        services.AddTableRepository<HubDeviceEntity>("HubDevices");

        services.TryAddSingleton<IHubDeviceRepository, TableHubDeviceRepository>();
        services.TryAddScoped<IHubDeviceService, HubDeviceService>();

        // Injected clock so PairedUtc/LastSeenUtc stay deterministically testable (7.5).
        services.TryAddSingleton(TimeProvider.System);

        return services;
    }
}
