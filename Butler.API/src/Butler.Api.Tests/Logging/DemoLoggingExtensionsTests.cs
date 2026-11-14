using Butler.Api.Infrastructure.Logging;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NSubstitute;
using Serilog.Extensions.Logging;

namespace Butler.Api.Tests.Logging;

/// <summary>
/// Criteria (#107 AC1, AC2): <see cref="DemoLoggingExtensions.AddDemoFileLogging"/>
/// adds the Serilog file provider in Demo only, binds its limits from the
/// <c>DemoLogging</c> section (with defaults), and resolves a relative directory
/// under the content root.
/// </summary>
public sealed class DemoLoggingExtensionsTests
{
    private static IHostEnvironment Environment(string name, string contentRoot = ".")
    {
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns(name);
        environment.ContentRootPath.Returns(contentRoot);
        return environment;
    }

    private static IConfiguration Configuration(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value)))
            .Build();

    private static ServiceProvider BuildLogging(IConfiguration configuration, IHostEnvironment environment) =>
        new ServiceCollection()
            .AddLogging(logging => logging.AddDemoFileLogging(configuration, environment))
            .BuildServiceProvider();

    [Theory]
    [InlineData("Development")]
    [InlineData("Production")]
    [InlineData("Staging")]
    public void Non_demo_environment_registers_no_file_sink(string environmentName)
    {
        using var provider = BuildLogging(Configuration(), Environment(environmentName));

        Assert.DoesNotContain(provider.GetServices<ILoggerProvider>(), p => p is SerilogLoggerProvider);
    }

    [Fact]
    public void Demo_environment_registers_the_file_sink()
    {
        var root = DemoLogFiles.NewDirectory();
        try
        {
            using var provider = BuildLogging(Configuration(), Environment("Demo", root));

            Assert.Contains(provider.GetServices<ILoggerProvider>(), p => p is SerilogLoggerProvider);
        }
        finally
        {
            DemoLogFiles.TryDelete(root);
        }
    }

    [Fact]
    public void Options_default_to_logs_directory_ten_mebibytes_and_ten_files()
    {
        var options = new DemoFileLoggingOptions();
        Configuration().GetSection(DemoFileLoggingOptions.SectionName).Bind(options);

        Assert.Equal("DemoLogging", DemoFileLoggingOptions.SectionName);
        Assert.Equal("logs", options.DirectoryPath);
        Assert.Equal("butler-api-.log", options.FileName);
        Assert.Equal(10L * 1024 * 1024, options.FileSizeLimitBytes);
        Assert.Equal(10, options.RetainedFileCountLimit);
    }

    [Fact]
    public void Relative_directory_resolves_under_content_root()
    {
        var root = DemoLogFiles.NewDirectory();
        try
        {
            using (var provider = BuildLogging(
                Configuration(("DemoLogging:DirectoryPath", "relative-logs")),
                Environment("Demo", root)))
            {
                provider.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("Butler.Tests")
                    .Log(LogLevel.Information, default, "hello from the demo file sink", null, (state, _) => state);
            }

            // Disposing the provider disposes (and flushes) the Serilog logger.
            var files = DemoLogFiles.Files(Path.Combine(root, "relative-logs"));
            var file = Assert.Single(files);
            Assert.Contains("hello from the demo file sink", File.ReadAllText(file), StringComparison.Ordinal);
        }
        finally
        {
            DemoLogFiles.TryDelete(root);
        }
    }

    [Fact]
    public void AddDemoFileLogging_rejects_null_arguments()
    {
        var logging = Substitute.For<ILoggingBuilder>();
        var configuration = Configuration();
        var environment = Environment("Demo");

        Assert.Throws<ArgumentNullException>(
            () => DemoLoggingExtensions.AddDemoFileLogging(null!, configuration, environment));
        Assert.Throws<ArgumentNullException>(() => logging.AddDemoFileLogging(null!, environment));
        Assert.Throws<ArgumentNullException>(() => logging.AddDemoFileLogging(configuration, null!));
    }

    [Fact]
    public void UseDemoRequestLogging_rejects_null_app()
    {
        Assert.Throws<ArgumentNullException>(() => DemoLoggingExtensions.UseDemoRequestLogging(null!));
    }

    [Fact]
    public void UseDemoRequestLogging_outside_demo_returns_the_app_unchanged()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Production" });
        var app = builder.Build();

        Assert.Same(app, app.UseDemoRequestLogging());
    }
}
