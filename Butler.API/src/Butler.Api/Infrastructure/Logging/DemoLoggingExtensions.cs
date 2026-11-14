using Butler.Api.Infrastructure.Hosting;
using Serilog;
using Serilog.Extensions.Logging;
using Serilog.Formatting.Compact;

namespace Butler.Api.Infrastructure.Logging;

/// <summary>
/// Demo-only structured logging (#107). In the Demo environment the API keeps
/// its default console logging and additionally writes every log event as one
/// compact-JSON line to a rolling file, plus one request-summary event per
/// request (path, status, duration, household id, correlation id). In every
/// other environment both extensions are no-ops.
/// </summary>
public static class DemoLoggingExtensions
{
    /// <summary>
    /// In the Demo environment, adds a Serilog rolling file sink as an extra
    /// logger provider alongside the default ones (console stays), filtered by
    /// the same <c>Logging:LogLevel</c> rules. The sink rolls
    /// daily and at <see cref="DemoFileLoggingOptions.FileSizeLimitBytes"/>, and
    /// keeps at most <see cref="DemoFileLoggingOptions.RetainedFileCountLimit"/>
    /// files. Outside Demo nothing is registered.
    /// </summary>
    /// <param name="logging">The logging builder.</param>
    /// <param name="configuration">Configuration holding the <see cref="DemoFileLoggingOptions.SectionName"/> section.</param>
    /// <param name="environment">The host environment.</param>
    /// <returns>The same logging builder.</returns>
    public static ILoggingBuilder AddDemoFileLogging(
        this ILoggingBuilder logging,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(logging);
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(environment);

        if (!environment.IsDemo())
        {
            return logging;
        }

        var options = new DemoFileLoggingOptions();
        configuration.GetSection(DemoFileLoggingOptions.SectionName).Bind(options);

        var directory = Path.Combine(environment.ContentRootPath, options.DirectoryPath);

        // Serilog's file sink never throws into the app: an unwritable directory
        // (for example a root-owned bind mount) only loses the file output.
        var logger = new LoggerConfiguration()
            .MinimumLevel.Verbose()
            .WriteTo.File(
                new CompactJsonFormatter(),
                Path.Combine(directory, options.FileName),
                fileSizeLimitBytes: options.FileSizeLimitBytes,
                rollOnFileSizeLimit: true,
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: options.RetainedFileCountLimit)
            .CreateLogger();

        // Registered as a plain provider rather than through AddSerilog, which
        // also adds a Trace-level filter rule for this provider and so bypasses
        // Logging:LogLevel. This way the same level rules as the console apply
        // (Logging:Serilog:LogLevel can still tune the file alone). Created by
        // the container, so it is disposed - and the file flushed - with the host.
        logging.Services.AddSingleton<ILoggerProvider>(_ => new SerilogLoggerProvider(logger, dispose: true));

        return logging;
    }

    /// <summary>
    /// In the Demo environment, adds the request-summary logging middleware.
    /// Call it first, before <c>UseExceptionHandler</c>, so it observes the final
    /// status code of every request, including exceptions mapped to problem
    /// details. Outside Demo nothing is added.
    /// </summary>
    /// <param name="app">The web application.</param>
    /// <returns>The same web application.</returns>
    public static WebApplication UseDemoRequestLogging(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        if (!app.Environment.IsDemo())
        {
            return app;
        }

        app.UseMiddleware<RequestLoggingMiddleware>();

        return app;
    }
}
