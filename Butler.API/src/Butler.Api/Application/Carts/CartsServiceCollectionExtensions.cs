using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.Carts;

/// <summary>
/// Composition entry point for the Carts feature (Engineering Contract 7.2).
/// Registers the <c>Carts</c> and <c>CartItems</c> tables on the shared F3
/// storage seam, their repositories, the cart service, and the injected clock;
/// <c>Program.cs</c> wires it with a single <see cref="AddCartsFeature"/> call.
/// This is the persistence base the capture flow (G3) writes into and the confirm
/// flow (G4) transitions.
/// </summary>
public static class CartsServiceCollectionExtensions
{
    /// <summary>Registers everything the Carts feature needs.</summary>
    public static IServiceCollection AddCartsFeature(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The tables this feature owns on the shared F3 seam (7.3).
        services.AddTableRepository<CartEntity>("Carts");
        services.AddTableRepository<CartItemEntity>("CartItems");

        services.TryAddSingleton<ICartRepository, TableCartRepository>();
        services.TryAddSingleton<ICartItemRepository, TableCartItemRepository>();

        // The get-or-create + compose read model. Scoped like the other
        // application services; it orchestrates per-request repository work.
        services.TryAddScoped<ICartService, CartService>();

        // Injected clock so the current weekIso stays deterministically testable;
        // no cart code path reads DateTime.Now (7.5).
        services.TryAddSingleton(TimeProvider.System);

        return services;
    }
}
