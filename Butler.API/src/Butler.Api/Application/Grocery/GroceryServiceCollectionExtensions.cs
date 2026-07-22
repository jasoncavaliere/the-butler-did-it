using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.Grocery;

/// <summary>
/// Composition entry point for the store-connector feature (Engineering Contract
/// 7.2, BRD decision D-4). Registers the <see cref="IStoreConnector"/> seam bound
/// to the v1 <see cref="SimulatedHebConnector"/> over the checked-in fixture
/// catalog; <c>Program.cs</c> wires it with a single
/// <see cref="AddStoreConnectorFeature"/> call. The connector is a singleton: the
/// catalog is immutable and the search is stateless, so one instance is safe to
/// share.
/// </summary>
public static class GroceryServiceCollectionExtensions
{
    /// <summary>Registers the store-connector seam and its v1 implementation.</summary>
    public static IServiceCollection AddStoreConnectorFeature(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The catalog is loaded once from the embedded fixture (fully offline) and
        // held for the connector's lifetime.
        services.TryAddSingleton<IStoreConnector>(_ => new SimulatedHebConnector(HebCatalog.Load()));

        return services;
    }
}
