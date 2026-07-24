using Butler.Api.Application.Carts;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Carts;

/// <summary>
/// Criterion: <c>AddCartsFeature()</c> registers both cart tables on the shared F3
/// seam, their repositories, the cart service, and the injected clock, so
/// <c>Program.cs</c> wires the whole feature with one call (Engineering Contract
/// 7.2).
/// </summary>
public sealed class CartsServiceCollectionExtensionsTests
{
    private static ServiceCollection BuildServices()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>())
            .Build();

        var services = new ServiceCollection();
        services.AddStorage(configuration);
        services.AddCartsFeature();
        return services;
    }

    [Fact]
    public void AddCartsFeature_registers_both_repositories()
    {
        using var provider = BuildServices().BuildServiceProvider();

        Assert.IsType<TableCartRepository>(provider.GetRequiredService<ICartRepository>());
        Assert.IsType<TableCartItemRepository>(provider.GetRequiredService<ICartItemRepository>());
    }

    [Fact]
    public void AddCartsFeature_registers_both_feature_tables()
    {
        using var provider = BuildServices().BuildServiceProvider();

        Assert.NotNull(provider.GetService<IEntityRepository<CartEntity>>());
        Assert.NotNull(provider.GetService<IEntityRepository<CartItemEntity>>());
    }

    [Fact]
    public void AddCartsFeature_registers_the_injected_clock()
    {
        using var provider = BuildServices().BuildServiceProvider();

        Assert.NotNull(provider.GetService<TimeProvider>());
    }

    [Fact]
    public void AddCartsFeature_registers_the_cart_service()
    {
        // The service's household repository is registered by the Households
        // feature, so assert the descriptor is present rather than resolving it
        // from this feature in isolation.
        Assert.Contains(BuildServices(), descriptor => descriptor.ServiceType == typeof(ICartService));
    }

    [Fact]
    public void AddCartsFeature_rejects_a_null_service_collection()
    {
        Assert.Throws<ArgumentNullException>(
            () => CartsServiceCollectionExtensions.AddCartsFeature(null!));
    }
}
