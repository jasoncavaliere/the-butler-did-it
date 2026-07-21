using Butler.Api.Application.Fairness;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Fairness;

/// <summary>
/// Criterion: <c>AddFairnessFeature()</c> registers the read model and the shared
/// clock, so <c>Program.cs</c> wires the feature with one call (Engineering
/// Contract 7.2). The service's own dependencies (household/completion/person
/// repositories) are owned by their features, so the descriptor is asserted
/// present rather than resolved from this feature in isolation.
/// </summary>
public sealed class FairnessServiceCollectionExtensionsTests
{
    [Fact]
    public void AddFairnessFeature_registers_the_fairness_service()
    {
        var services = new ServiceCollection();
        services.AddFairnessFeature();

        Assert.Contains(services, d => d.ServiceType == typeof(IFairnessService));
    }

    [Fact]
    public void AddFairnessFeature_registers_the_injected_clock()
    {
        var services = new ServiceCollection();
        services.AddFairnessFeature();

        using var provider = services.BuildServiceProvider();
        Assert.NotNull(provider.GetService<TimeProvider>());
    }

    [Fact]
    public void AddFairnessFeature_rejects_a_null_service_collection()
    {
        Assert.Throws<ArgumentNullException>(
            () => FairnessServiceCollectionExtensions.AddFairnessFeature(null!));
    }
}
