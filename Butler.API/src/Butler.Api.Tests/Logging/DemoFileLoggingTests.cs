using System.Net;
using System.Text.Json;
using Butler.Api.Infrastructure.Logging;
using Butler.Api.Tests.TestSupport;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Console;
using Serilog.Extensions.Logging;

namespace Butler.Api.Tests.Logging;

/// <summary>
/// Criteria (#107 AC1-AC5) end to end through the real <c>Program</c>: in the
/// Demo environment every request writes one structured compact-JSON line
/// (method, path, status, duration, household id, correlation id) to a rolling
/// file, alongside the console; the sink has a size and a retention limit; the
/// correlation id equals the RFC 7807 <c>traceId</c>; and outside Demo no file
/// is written. Each test owns a fresh temp log directory and disposes its host
/// (closing the file) before deleting it.
/// </summary>
public sealed class DemoFileLoggingTests
{
    private static readonly Uri HealthUri = new("/health", UriKind.Relative);

    private static bool IsRequestEvent(JsonElement e) =>
        e.TryGetProperty("CorrelationId", out _) && e.TryGetProperty("StatusCode", out _);

    [Fact]
    public async Task Demo_request_writes_structured_line_with_path_status_duration_household_and_correlation()
    {
        var dir = DemoLogFiles.NewDirectory();
        try
        {
            await using var factory = DemoLogFiles.CreateDemoFactory(dir);
            using var client = factory.CreateClient();

            using var response = await client.GetAsync(new Uri("/households/hh-ac1", UriKind.Relative));
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

            var events = await DemoLogFiles.WaitForEventsAsync(
                dir,
                e => IsRequestEvent(e) && e.HasString("Path", "/households/hh-ac1"));
            var entry = Assert.Single(events);

            Assert.True(entry.TryGetProperty("@t", out _), "compact JSON carries a timestamp");
            Assert.Equal(
                "HTTP {Method} {Path} responded {StatusCode} in {ElapsedMs} ms (household {HouseholdId}, correlation {CorrelationId})",
                entry.GetProperty("@mt").GetString());
            Assert.True(entry.HasString("Method", "GET"));
            Assert.Equal(404, entry.GetProperty("StatusCode").GetInt32());
            Assert.True(entry.GetProperty("ElapsedMs").GetDouble() >= 0);
            Assert.True(entry.HasString("HouseholdId", "hh-ac1"));
            Assert.False(string.IsNullOrWhiteSpace(entry.GetProperty("CorrelationId").GetString()));
            Assert.True(entry.HasString("SourceContext", typeof(RequestLoggingMiddleware).FullName!));
        }
        finally
        {
            DemoLogFiles.TryDelete(dir);
        }
    }

    [Fact]
    public async Task Demo_request_without_household_route_logs_a_null_household()
    {
        var dir = DemoLogFiles.NewDirectory();
        try
        {
            await using var factory = DemoLogFiles.CreateDemoFactory(dir);
            using var client = factory.CreateClient();

            using var response = await client.GetAsync(HealthUri);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);

            var events = await DemoLogFiles.WaitForEventsAsync(
                dir,
                e => IsRequestEvent(e) && e.HasString("Path", "/health"));
            var entry = Assert.Single(events);
            Assert.Equal(200, entry.GetProperty("StatusCode").GetInt32());
            Assert.Equal(JsonValueKind.Null, entry.GetProperty("HouseholdId").ValueKind);
        }
        finally
        {
            DemoLogFiles.TryDelete(dir);
        }
    }

    [Fact]
    public async Task File_sink_applies_the_same_log_level_rules_as_the_console()
    {
        var dir = DemoLogFiles.NewDirectory();
        try
        {
            await using (var factory = DemoLogFiles.CreateDemoFactory(dir))
            {
                using var client = factory.CreateClient();
                using var response = await client.GetAsync(HealthUri);
                await DemoLogFiles.WaitForEventsAsync(dir, e => IsRequestEvent(e) && e.HasString("Path", "/health"));
            }

            // appsettings: Default Information, Microsoft.AspNetCore Warning. In
            // compact JSON an Information event carries no @l at all.
            var events = DemoLogFiles.ReadEvents(dir);
            Assert.NotEmpty(events);
            Assert.All(events, e =>
            {
                var level = e.TryGetProperty("@l", out var l) ? l.GetString() : "Information";
                Assert.NotEqual("Verbose", level);
                Assert.NotEqual("Debug", level);
                if (level == "Information")
                {
                    Assert.False(
                        e.TryGetProperty("SourceContext", out var source)
                        && source.GetString()!.StartsWith("Microsoft.AspNetCore.", StringComparison.Ordinal),
                        $"Microsoft.AspNetCore is filtered to Warning, but logged: {e}");
                }
            });
        }
        finally
        {
            DemoLogFiles.TryDelete(dir);
        }
    }

    [Fact]
    public async Task Demo_keeps_console_logging_alongside_the_file_sink()
    {
        var dir = DemoLogFiles.NewDirectory();
        try
        {
            await using var factory = DemoLogFiles.CreateDemoFactory(dir);

            var providers = factory.Services.GetServices<ILoggerProvider>().ToList();

            Assert.Contains(providers, p => p is ConsoleLoggerProvider);
            Assert.Contains(providers, p => p is SerilogLoggerProvider);
        }
        finally
        {
            DemoLogFiles.TryDelete(dir);
        }
    }

    [Fact]
    public async Task Development_app_writes_no_log_file()
    {
        var dir = DemoLogFiles.NewDirectory();
        try
        {
            await using (var factory = DemoLogFiles.CreateFactory("Development", dir))
            {
                using var client = factory.CreateClient();
                using var response = await client.GetAsync(new Uri("/households/hh-dev", UriKind.Relative));
                Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

                Assert.DoesNotContain(
                    factory.Services.GetServices<ILoggerProvider>(),
                    p => p is SerilogLoggerProvider);
            }

            Assert.False(Directory.Exists(dir), "no file sink outside Demo, so no log directory");
        }
        finally
        {
            DemoLogFiles.TryDelete(dir);
        }
    }

    [Fact]
    public async Task Demo_settings_configure_size_and_retention_limits()
    {
        var dir = DemoLogFiles.NewDirectory();
        try
        {
            await using var factory = DemoLogFiles.CreateDemoFactory(dir);

            // appsettings.Demo.json, as the container image loads it.
            var options = new DemoFileLoggingOptions();
            factory.Services.GetRequiredService<IConfiguration>()
                .GetSection(DemoFileLoggingOptions.SectionName)
                .Bind(options);

            Assert.Equal(10L * 1024 * 1024, options.FileSizeLimitBytes);
            Assert.Equal(10, options.RetainedFileCountLimit);
        }
        finally
        {
            DemoLogFiles.TryDelete(dir);
        }
    }

    [Fact]
    public async Task File_sink_rolls_to_a_new_file_at_the_size_limit()
    {
        const int Limit = 2048;
        const string LimitSetting = "2048";
        var dir = DemoLogFiles.NewDirectory();
        try
        {
            await using (var factory = DemoLogFiles.CreateDemoFactory(
                dir,
                ("DemoLogging:FileSizeLimitBytes", LimitSetting),
                ("DemoLogging:RetainedFileCountLimit", "100")))
            {
                using var client = factory.CreateClient();
                await RequestUntilAsync(client, () => DemoLogFiles.Files(dir).Length >= 3);
            }

            var files = DemoLogFiles.Files(dir);
            Assert.True(files.Length >= 3, $"expected rolled files, found {files.Length}");
            Assert.Contains(files, f => Path.GetFileNameWithoutExtension(f).EndsWith("_001", StringComparison.Ordinal));

            // A file stops taking events once it reaches the limit, so it never
            // grows past the limit by more than one event.
            Assert.All(files, f => Assert.True(new FileInfo(f).Length < Limit * 2, $"{f} exceeded the size limit"));
        }
        finally
        {
            DemoLogFiles.TryDelete(dir);
        }
    }

    [Fact]
    public async Task File_sink_keeps_no_more_files_than_the_retention_limit()
    {
        var dir = DemoLogFiles.NewDirectory();
        try
        {
            await using (var factory = DemoLogFiles.CreateDemoFactory(
                dir,
                ("DemoLogging:FileSizeLimitBytes", "512"),
                ("DemoLogging:RetainedFileCountLimit", "2")))
            {
                using var client = factory.CreateClient();

                // Roll well past the limit: a fifth sequence file means at least
                // four rolls, each of which applies the retention policy.
                await RequestUntilAsync(
                    client,
                    () => DemoLogFiles.Files(dir).Any(f =>
                        Path.GetFileNameWithoutExtension(f).EndsWith("_004", StringComparison.Ordinal)));
            }

            Assert.Equal(2, DemoLogFiles.Files(dir).Length);
        }
        finally
        {
            DemoLogFiles.TryDelete(dir);
        }
    }

    [Theory]
    [InlineData("/households/hh-404", 404, "hh-404")] // controller Problem() path
    [InlineData("/test/households/hh-500/unhandled", 500, "hh-500")] // ApiExceptionHandler path
    public async Task Problem_response_trace_id_is_logged_as_correlation_id(string path, int status, string householdId)
    {
        var dir = DemoLogFiles.NewDirectory();
        try
        {
            await using var factory = DemoLogFiles.CreateDemoFactory(dir);
            using var client = factory.CreateClient();

            using var response = await client.GetAsync(new Uri(path, UriKind.Relative));
            Assert.Equal(status, (int)response.StatusCode);
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var traceId = body.RootElement.GetProperty("traceId").GetString()!;

            var events = await DemoLogFiles.WaitForEventsAsync(
                dir,
                e => IsRequestEvent(e) && e.HasString("CorrelationId", traceId));
            var entry = Assert.Single(events);

            Assert.True(entry.HasString("Path", path));
            Assert.Equal(status, entry.GetProperty("StatusCode").GetInt32());
            Assert.True(entry.HasString("HouseholdId", householdId));
        }
        finally
        {
            DemoLogFiles.TryDelete(dir);
        }
    }

    [Fact]
    public async Task Unwritable_log_directory_does_not_break_startup()
    {
        var dir = DemoLogFiles.NewDirectory();
        try
        {
            // A regular file where a directory is needed: the sink cannot create
            // its folder on any OS or user, as with a root-owned bind mount.
            Directory.CreateDirectory(dir);
            var blocker = Path.Combine(dir, "blocker");
            await File.WriteAllTextAsync(blocker, "not a directory");

            await using var factory = DemoLogFiles.CreateDemoFactory(Path.Combine(blocker, "logs"));
            using var client = factory.CreateClient();

            using var response = await client.GetAsync(HealthUri);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
        finally
        {
            DemoLogFiles.TryDelete(dir);
        }
    }

    // Sends requests until the condition holds (or a generous cap is reached).
    private static async Task RequestUntilAsync(HttpClient client, Func<bool> condition)
    {
        for (var i = 0; i < 200 && !condition(); i++)
        {
            using var response = await client.GetAsync(new Uri($"/households/hh-roll-{i}", UriKind.Relative));
        }
    }
}
