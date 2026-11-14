using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Butler.Api.Tests.TestSupport;

/// <summary>
/// Helpers for the Demo-only rolling log file (#107): boot the API in the Demo
/// environment against a given log directory, and read back the compact-JSON
/// events it wrote.
/// </summary>
public static class DemoLogFiles
{
    /// <summary>The file pattern the Demo sink writes (<c>butler-api-&lt;date&gt;[_NNN].log</c>).</summary>
    public const string SearchPattern = "butler-api-*.log";

    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(5);

    /// <summary>A unique, not-yet-created log directory under the system temp directory.</summary>
    public static string NewDirectory() =>
        Path.Combine(Path.GetTempPath(), "butler-api-tests", Guid.NewGuid().ToString("N"));

    /// <summary>
    /// A Demo-environment factory whose file sink writes to
    /// <paramref name="logDirectory"/>, with any extra configuration overrides.
    /// </summary>
    /// <param name="logDirectory">The <c>DemoLogging:DirectoryPath</c> to use.</param>
    /// <param name="settings">Extra <c>key=value</c> configuration overrides.</param>
    public static WebApplicationFactory<Program> CreateDemoFactory(
        string logDirectory,
        params (string Key, string Value)[] settings) =>
        CreateFactory("Demo", logDirectory, settings);

    /// <summary>
    /// A factory in <paramref name="environment"/> whose (Demo-only) file sink
    /// would write to <paramref name="logDirectory"/>.
    /// </summary>
    public static WebApplicationFactory<Program> CreateFactory(
        string environment,
        string logDirectory,
        params (string Key, string Value)[] settings) =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            builder.UseSetting("DemoLogging:DirectoryPath", logDirectory);
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }
        });

    /// <summary>The Demo log files currently in <paramref name="logDirectory"/> (none when it does not exist).</summary>
    public static string[] Files(string logDirectory) =>
        Directory.Exists(logDirectory)
            ? Directory.GetFiles(logDirectory, SearchPattern)
            : [];

    /// <summary>Every event currently written to the log files in <paramref name="logDirectory"/>.</summary>
    public static IReadOnlyList<JsonElement> ReadEvents(string logDirectory)
    {
        var events = new List<JsonElement>();
        foreach (var file in Files(logDirectory).Order(StringComparer.Ordinal))
        {
            // The sink keeps the current file open; share it rather than lock it.
            using var stream = new FileStream(
                file,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete);
            using var reader = new StreamReader(stream);
            while (reader.ReadLine() is { } line)
            {
                if (line.Length == 0)
                {
                    continue;
                }

                // A line still being flushed may be partial; skip it this round.
                try
                {
                    using var doc = JsonDocument.Parse(line);
                    events.Add(doc.RootElement.Clone());
                }
                catch (JsonException)
                {
                }
            }
        }

        return events;
    }

    /// <summary>
    /// Polls the log files until at least one event matches
    /// <paramref name="predicate"/> (the request event is written after the
    /// response is sent, so it can trail the client), then returns the matches.
    /// Fails the test when none appears within <paramref name="timeout"/>.
    /// </summary>
    public static async Task<IReadOnlyList<JsonElement>> WaitForEventsAsync(
        string logDirectory,
        Func<JsonElement, bool> predicate,
        TimeSpan? timeout = null)
    {
        var deadline = DateTime.UtcNow + (timeout ?? DefaultTimeout);
        while (true)
        {
            var matches = ReadEvents(logDirectory).Where(predicate).ToList();
            if (matches.Count > 0)
            {
                return matches;
            }

            if (DateTime.UtcNow >= deadline)
            {
                Assert.Fail($"No matching log event in '{logDirectory}' within the timeout.");
            }

            await Task.Delay(50);
        }
    }

    /// <summary>Whether <paramref name="element"/> has string property <paramref name="name"/> equal to <paramref name="value"/>.</summary>
    public static bool HasString(this JsonElement element, string name, string value) =>
        element.TryGetProperty(name, out var property)
        && property.ValueKind == JsonValueKind.String
        && property.GetString() == value;

    /// <summary>Deletes <paramref name="logDirectory"/> if it exists, ignoring a file the OS still holds.</summary>
    public static void TryDelete(string logDirectory)
    {
        try
        {
            if (Directory.Exists(logDirectory))
            {
                Directory.Delete(logDirectory, recursive: true);
            }
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
