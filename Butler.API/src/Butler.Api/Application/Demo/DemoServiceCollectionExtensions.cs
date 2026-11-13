using Butler.Api.Infrastructure.Demo;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.Demo;

/// <summary>
/// Composition entry point for the demo seeder (#97). It owns no table of its
/// own: it composes the other features' services and repositories, so it must be
/// registered alongside them. <c>Program.cs</c> wires it with a single
/// <see cref="AddDemoFeature"/> call.
/// </summary>
public static class DemoServiceCollectionExtensions
{
    /// <summary>Registers the demo seeder and the household purger it uses.</summary>
    public static IServiceCollection AddDemoFeature(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddScoped<IDemoHouseholdPurger, DemoHouseholdPurger>();
        services.TryAddScoped<IDemoSeeder, DemoSeeder>();

        // Every seeded date derives from the injected clock (Contract 7.5).
        services.TryAddSingleton(TimeProvider.System);

        return services;
    }
}
