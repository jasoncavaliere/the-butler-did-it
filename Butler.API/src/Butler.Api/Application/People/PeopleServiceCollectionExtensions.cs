using Butler.Api.Infrastructure.People;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.People;

/// <summary>
/// Composition entry point for the People feature (Engineering Contract 7.2).
/// Registers the <c>People</c> table on the shared F3 storage seam, the
/// repository, and the application service; <c>Program.cs</c> wires it with a
/// single <see cref="AddPeopleFeature"/> call. The <c>People</c> table is also
/// registered by the Households feature (H1 seeds the organizer row) - the
/// <c>TryAdd</c> registration keeps that idempotent regardless of wiring order.
/// </summary>
public static class PeopleServiceCollectionExtensions
{
    /// <summary>Registers everything the People feature needs.</summary>
    public static IServiceCollection AddPeopleFeature(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The table this feature owns on the shared F3 seam (7.3).
        services.AddTableRepository<PersonEntity>("People");

        services.TryAddSingleton<IPersonRepository, TablePersonRepository>();
        services.TryAddScoped<IPersonService, PersonService>();

        return services;
    }
}
