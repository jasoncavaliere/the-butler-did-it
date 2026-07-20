using Butler.Api.Infrastructure.Chores;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.Chores;

/// <summary>
/// Composition entry point for the Chores feature (Engineering Contract 7.2).
/// Registers the <c>Chores</c> table on the shared F3 storage seam, the
/// repository, and the application service; <c>Program.cs</c> wires it with a
/// single <see cref="AddChoresFeature"/> call. The service depends on the Rooms
/// repository (registered by <c>AddRoomsFeature</c>) to validate a chore's room
/// reference.
/// </summary>
public static class ChoresServiceCollectionExtensions
{
    /// <summary>Registers everything the Chores feature needs.</summary>
    public static IServiceCollection AddChoresFeature(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The table this feature owns on the shared F3 seam (7.3).
        services.AddTableRepository<ChoreEntity>("Chores");

        services.TryAddSingleton<IChoreRepository, TableChoreRepository>();
        services.TryAddScoped<IChoreService, ChoreService>();

        return services;
    }
}
