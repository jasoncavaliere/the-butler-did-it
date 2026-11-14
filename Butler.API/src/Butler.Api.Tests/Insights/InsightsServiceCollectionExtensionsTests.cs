using Butler.Api.Application.Insights;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Insights;

/// <summary>
/// Criterion: <c>AddInsightsFeature()</c> registers the read model and the shared
/// clock, so <c>Program.cs</c> wires the feature with one call (Engineering
/// Contract 7.2). The service's repositories are owned by their features, so the
/// descriptor is asserted present rather than resolved in isolation.
/// </summary>
public sealed class InsightsServiceCollectionExtensionsTests
{
    [Fact]
    public void AddInsightsFeature_registers_the_insights_service()
    {
        var services = new ServiceCollection();
        services.AddInsightsFeature();

        Assert.Contains(services, d => d.ServiceType == typeof(IInsightsService));
    }

    [Fact]
    public void AddInsightsFeature_registers_the_injected_clock()
    {
        var services = new ServiceCollection();
        services.AddInsightsFeature();

        using var provider = services.BuildServiceProvider();
        Assert.NotNull(provider.GetService<TimeProvider>());
    }

    [Fact]
    public void AddInsightsFeature_rejects_a_null_service_collection()
    {
        Assert.Throws<ArgumentNullException>(
            () => InsightsServiceCollectionExtensions.AddInsightsFeature(null!));
    }
}
