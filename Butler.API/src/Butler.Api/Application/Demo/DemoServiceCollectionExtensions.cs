using Butler.Api.Infrastructure.Demo;
using Butler.Api.Infrastructure.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace Butler.Api.Application.Demo;

/// <summary>
/// Composition entry point for the demo seeder (#97). It owns no table of its
/// own: it composes the other features' services and repositories, so it must be
/// registered alongside them. <c>Program.cs</c> wires it with a single
/// <see cref="AddDemoFeature"/> call, which also keeps the demo endpoints
/// unmapped outside Development and Demo (#106).
/// </summary>
public static class DemoServiceCollectionExtensions
{
    /// <summary>
    /// Registers the demo seeder and the household purger it uses, plus the
    /// <see cref="DemoOnlyControllerFeatureProvider"/> that drops every
    /// <see cref="DemoOnlyAttribute"/> controller (the <c>/demo/*</c> routes)
    /// when <paramref name="environment"/> is neither Development nor Demo.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="environment">The host environment.</param>
    public static IServiceCollection AddDemoFeature(this IServiceCollection services, IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(environment);

        services.TryAddScoped<IDemoHouseholdPurger, DemoHouseholdPurger>();
        services.TryAddScoped<IDemoSeeder, DemoSeeder>();

        // Every seeded date derives from the injected clock (Contract 7.5).
        services.TryAddSingleton(TimeProvider.System);

        // Appended, so it runs after the default ControllerFeatureProvider (which
        // AddMvcCore adds first when it is missing) and sees every controller.
        services.AddMvcCore().ConfigureApplicationPartManager(manager =>
            manager.FeatureProviders.Add(new DemoOnlyControllerFeatureProvider(environment)));

        return services;
    }
}
