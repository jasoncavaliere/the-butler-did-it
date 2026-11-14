using System.Reflection;
using Butler.Api.Application.Demo;
using Butler.Api.Controllers;
using Butler.Api.Infrastructure.Hosting;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using NSubstitute;

namespace Butler.Api.Tests.Hosting;

/// <summary>
/// Criteria (#106 AC2, AC3): <see cref="DemoOnlyControllerFeatureProvider"/>
/// drops every <see cref="DemoOnlyAttribute"/> controller outside Development
/// and Demo and leaves the controller set alone inside them, and
/// <see cref="DemoServiceCollectionExtensions.AddDemoFeature"/> registers it.
/// </summary>
public sealed class DemoOnlyControllerFeatureProviderTests
{
    private static IHostEnvironment EnvironmentNamed(string name)
    {
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns(name);
        return environment;
    }

    private static ControllerFeature PopulatedFeature(string environmentName)
    {
        var feature = new ControllerFeature();
        feature.Controllers.Add(typeof(DemoController).GetTypeInfo());
        feature.Controllers.Add(typeof(RoomsController).GetTypeInfo());

        new DemoOnlyControllerFeatureProvider(EnvironmentNamed(environmentName))
            .PopulateFeature(Array.Empty<ApplicationPart>(), feature);

        return feature;
    }

    [Fact]
    public void Demo_controller_carries_the_demo_only_marker()
    {
        Assert.True(typeof(DemoController).IsDefined(typeof(DemoOnlyAttribute), inherit: false));
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public void Outside_Development_or_Demo_demo_only_controllers_are_removed(string environmentName)
    {
        var feature = PopulatedFeature(environmentName);

        var remaining = Assert.Single(feature.Controllers);
        Assert.Equal(typeof(RoomsController), remaining.AsType());
    }

    [Theory]
    [InlineData("Development")]
    [InlineData(ButlerEnvironments.Demo)]
    public void In_Development_and_Demo_every_controller_is_kept(string environmentName)
    {
        var feature = PopulatedFeature(environmentName);

        Assert.Equal(2, feature.Controllers.Count);
        Assert.Contains(feature.Controllers, controller => controller.AsType() == typeof(DemoController));
    }

    [Fact]
    public void Constructor_rejects_a_null_environment()
    {
        Assert.Throws<ArgumentNullException>(() => new DemoOnlyControllerFeatureProvider(null!));
    }

    [Fact]
    public void PopulateFeature_rejects_a_null_feature()
    {
        var provider = new DemoOnlyControllerFeatureProvider(EnvironmentNamed("Production"));

        Assert.Throws<ArgumentNullException>(() => provider.PopulateFeature(Array.Empty<ApplicationPart>(), null!));
    }

    [Fact]
    public void AddDemoFeature_registers_the_provider_after_the_default_controller_provider()
    {
        var services = new ServiceCollection();

        services.AddDemoFeature(EnvironmentNamed("Production"));

        var manager = Assert.Single(
            services,
            descriptor => descriptor.ServiceType == typeof(ApplicationPartManager)).ImplementationInstance;
        var providers = Assert.IsType<ApplicationPartManager>(manager).FeatureProviders;
        var defaultIndex = providers.ToList().FindIndex(provider => provider is ControllerFeatureProvider);
        var demoIndex = providers.ToList().FindIndex(provider => provider is DemoOnlyControllerFeatureProvider);
        Assert.InRange(defaultIndex, 0, int.MaxValue);
        Assert.True(demoIndex > defaultIndex);
    }

    [Fact]
    public void AddDemoFeature_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() =>
            ((IServiceCollection)null!).AddDemoFeature(EnvironmentNamed("Development")));
        Assert.Throws<ArgumentNullException>(() => new ServiceCollection().AddDemoFeature(null!));
    }
}
