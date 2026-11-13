using Butler.Api.Application.Demo;
using Microsoft.Extensions.Configuration;

namespace Butler.Api.Tests.Demo;

/// <summary>
/// Criterion (#97 AC4): <see cref="DemoCommandLine.Normalize"/> turns the bare
/// <c>--seed-demo</c> switch into a configuration value and leaves every other
/// argument alone - including the one right after the switch, which a bare
/// <c>--key</c> would otherwise swallow as its value.
/// </summary>
public sealed class DemoCommandLineTests
{
    [Theory]
    [InlineData("--seed-demo")]
    [InlineData("--SEED-DEMO")]
    [InlineData("--Seed-Demo")]
    public void Normalize_rewrites_the_seed_demo_switch(string flag)
    {
        var normalized = DemoCommandLine.Normalize([flag]);

        Assert.Equal(["--Demo:SeedOnStartup=true"], normalized);
    }

    [Fact]
    public void Normalize_leaves_other_args_untouched()
    {
        Assert.Equal(
            ["--Demo:SeedOnStartup=true", "--urls", "http://localhost:5108"],
            DemoCommandLine.Normalize(["--seed-demo", "--urls", "http://localhost:5108"]));
        Assert.Equal(
            ["--urls", "http://localhost:5108", "--environment", "Demo"],
            DemoCommandLine.Normalize(["--urls", "http://localhost:5108", "--environment", "Demo"]));
        Assert.Empty(DemoCommandLine.Normalize([]));
    }

    [Fact]
    public void Normalized_args_bind_the_seed_flag_and_keep_urls()
    {
        var configuration = new ConfigurationBuilder()
            .AddCommandLine(DemoCommandLine.Normalize(["--seed-demo", "--urls", "http://localhost:5108"]))
            .Build();

        Assert.Equal("true", configuration[DemoCommandLine.SeedOnStartupKey]);
        Assert.Equal("http://localhost:5108", configuration["urls"]);
    }
}
