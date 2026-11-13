using Butler.Api.Infrastructure.Hosting;
using Microsoft.Extensions.Hosting;
using NSubstitute;

namespace Butler.Api.Tests.Hosting;

/// <summary>
/// Criteria (#95): <see cref="ButlerEnvironments"/> recognises the <c>Demo</c>
/// environment (case-insensitively, like the framework helpers) and treats
/// Development or Demo - and nothing else - as the environments that serve
/// Swagger and may opt into the organizer-auth bypass.
/// </summary>
public sealed class ButlerEnvironmentsTests
{
    private static IHostEnvironment EnvironmentNamed(string name)
    {
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns(name);
        return environment;
    }

    [Theory]
    [InlineData("Development", true)]
    [InlineData("Demo", true)]
    [InlineData("demo", true)]
    [InlineData("Production", false)]
    [InlineData("Staging", false)]
    public void IsDevelopmentOrDemo_matches_only_Development_and_Demo(string name, bool expected)
    {
        Assert.Equal(expected, EnvironmentNamed(name).IsDevelopmentOrDemo());
    }

    [Theory]
    [InlineData("Demo", true)]
    [InlineData("Development", false)]
    public void IsDemo_matches_only_Demo(string name, bool expected)
    {
        Assert.Equal(expected, EnvironmentNamed(name).IsDemo());
    }

    [Fact]
    public void IsDemo_rejects_a_null_environment()
    {
        Assert.Throws<ArgumentNullException>(() => ButlerEnvironments.IsDemo(null!));
    }

    [Fact]
    public void IsDevelopmentOrDemo_rejects_a_null_environment()
    {
        Assert.Throws<ArgumentNullException>(() => ButlerEnvironments.IsDevelopmentOrDemo(null!));
    }
}
