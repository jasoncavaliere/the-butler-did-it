using Butler.Api.Application.Capture;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;

namespace Butler.Api.Tests.Capture;

/// <summary>
/// Criterion (G3 / Engineering Contract 7.2): the feature registers itself through
/// one <c>Add&lt;Feature&gt;Feature()</c> extension - the shared handler plus both
/// v1 sources behind the <see cref="ICaptureSource"/> seam - so <c>Program.cs</c>
/// wires capture with a single call.
/// </summary>
public sealed class CaptureServiceCollectionExtensionsTests
{
    private static ServiceProvider BuildProvider()
    {
        var services = new ServiceCollection();
        // The handler's own collaborators belong to the Carts and store-connector
        // features, so substitute it here and assert the seam wiring in isolation.
        services.AddSingleton(Substitute.For<ICaptureHandler>());
        services.AddCaptureFeature();
        return services.BuildServiceProvider();
    }

    [Fact]
    public void AddCaptureFeature_registers_the_shared_handler()
    {
        var services = new ServiceCollection();
        services.AddCaptureFeature();

        var descriptor = Assert.Single(
            services, candidate => candidate.ServiceType == typeof(ICaptureHandler));
        Assert.Equal(typeof(CaptureHandler), descriptor.ImplementationType);
        Assert.Equal(ServiceLifetime.Scoped, descriptor.Lifetime);
    }

    [Fact]
    public void AddCaptureFeature_registers_both_v1_sources_behind_the_seam()
    {
        using var provider = BuildProvider();
        using var scope = provider.CreateScope();

        var sources = scope.ServiceProvider.GetServices<ICaptureSource>().ToList();

        Assert.Equal(2, sources.Count);
        Assert.Contains(sources, source => source is HubTextCaptureSource);
        Assert.Contains(sources, source => source is SimulatedVoiceCaptureSource);
        Assert.Contains(sources, source => source.SourceName == CaptureSourceNames.HubText);
        Assert.Contains(sources, source => source.SourceName == CaptureSourceNames.SimulatedVoice);
    }

    [Fact]
    public void AddCaptureFeature_is_idempotent()
    {
        var services = new ServiceCollection();
        services.AddSingleton(Substitute.For<ICaptureHandler>());
        services.AddCaptureFeature();
        services.AddCaptureFeature();

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        // Registering twice must not double-dispatch a captured utterance.
        Assert.Equal(2, scope.ServiceProvider.GetServices<ICaptureSource>().Count());
    }

    [Fact]
    public void AddCaptureFeature_rejects_a_null_service_collection()
    {
        Assert.Throws<ArgumentNullException>(
            () => CaptureServiceCollectionExtensions.AddCaptureFeature(null!));
    }
}
