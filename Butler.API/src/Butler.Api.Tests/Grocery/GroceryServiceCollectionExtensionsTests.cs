using Butler.Api.Application.Grocery;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Grocery;

/// <summary>
/// Criterion: <c>AddStoreConnectorFeature()</c> wires the <see cref="IStoreConnector"/>
/// seam to the v1 <see cref="SimulatedHebConnector"/>, so <c>Program.cs</c>
/// resolves the connector with one call (Engineering Contract 7.2).
/// </summary>
public sealed class GroceryServiceCollectionExtensionsTests
{
    [Fact]
    public void AddStoreConnectorFeature_resolves_the_simulated_heb_connector()
    {
        var services = new ServiceCollection();
        services.AddStoreConnectorFeature();
        using var provider = services.BuildServiceProvider();

        Assert.IsType<SimulatedHebConnector>(provider.GetRequiredService<IStoreConnector>());
    }

    [Fact]
    public async Task AddStoreConnectorFeature_resolves_a_connector_backed_by_the_fixture()
    {
        var services = new ServiceCollection();
        services.AddStoreConnectorFeature();
        using var provider = services.BuildServiceProvider();

        var connector = provider.GetRequiredService<IStoreConnector>();
        var results = await connector.SearchProductsAsync("milk", CancellationToken.None);

        Assert.NotEmpty(results);
    }

    [Fact]
    public void AddStoreConnectorFeature_rejects_a_null_service_collection()
    {
        Assert.Throws<ArgumentNullException>(
            () => GroceryServiceCollectionExtensions.AddStoreConnectorFeature(null!));
    }
}
