using Butler.Api.Infrastructure.Rooms;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.Rooms;

/// <summary>
/// Composition entry point for the Rooms feature (Engineering Contract 7.2).
/// Registers the <c>Rooms</c> table on the shared F3 storage seam, the repository,
/// and the application service; <c>Program.cs</c> wires it with a single
/// <see cref="AddRoomsFeature"/> call.
/// </summary>
public static class RoomsServiceCollectionExtensions
{
    /// <summary>Registers everything the Rooms feature needs.</summary>
    public static IServiceCollection AddRoomsFeature(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The table this feature owns on the shared F3 seam (7.3).
        services.AddTableRepository<RoomEntity>("Rooms");

        services.TryAddSingleton<IRoomRepository, TableRoomRepository>();
        services.TryAddScoped<IRoomService, RoomService>();

        return services;
    }
}
