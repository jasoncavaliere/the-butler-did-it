using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.People;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.Households;

/// <summary>
/// Composition entry point for the Households feature (Engineering Contract 7.2).
/// Registers the household aggregate's tables on the shared F3 storage seam, the
/// repository, the application service, and the clock; <c>Program.cs</c> wires it
/// with a single <see cref="AddHouseholdFeature"/> call.
/// </summary>
public static class HouseholdServiceCollectionExtensions
{
    /// <summary>Registers everything the Households feature needs.</summary>
    public static IServiceCollection AddHouseholdFeature(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Tables this feature owns on the shared F3 seam (7.3). H1 writes the
        // Households row and, partially, the People row (the organizer only).
        services.AddTableRepository<HouseholdEntity>("Households");
        services.AddTableRepository<PersonEntity>("People");

        services.TryAddSingleton<IHouseholdRepository, TableHouseholdRepository>();
        services.TryAddScoped<IHouseholdService, HouseholdService>();

        // Injected clock so CreatedUtc stays deterministically testable (7.5).
        services.TryAddSingleton(TimeProvider.System);

        return services;
    }
}
