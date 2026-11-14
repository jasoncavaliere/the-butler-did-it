namespace Butler.Api.Infrastructure.Logging;

/// <summary>
/// Settings for the Demo-only rolling file log sink (#107), bound from the
/// <see cref="SectionName"/> configuration section. Outside the Demo environment
/// these settings are ignored and no file sink is registered.
/// </summary>
public sealed class DemoFileLoggingOptions
{
    /// <summary>The configuration section the options bind from.</summary>
    public const string SectionName = "DemoLogging";

    /// <summary>
    /// The log directory. A relative path resolves under the host's content root
    /// (<c>/app</c> in the container, where the demo stack mounts
    /// <c>demo/.data/logs</c> at <c>/app/logs</c>).
    /// </summary>
    public string DirectoryPath { get; set; } = "logs";

    /// <summary>
    /// The file name template. The sink inserts the roll date (and a sequence
    /// number once a day's file reaches the size limit) before the extension,
    /// for example <c>butler-api-20261114.log</c>, <c>butler-api-20261114_001.log</c>.
    /// </summary>
    public string FileName { get; set; } = "butler-api-.log";

    /// <summary>The size at which the sink rolls to a new file (default 10 MiB).</summary>
    public long FileSizeLimitBytes { get; set; } = 10 * 1024 * 1024;

    /// <summary>The most log files kept on disk; older files are deleted (default 10).</summary>
    public int RetainedFileCountLimit { get; set; } = 10;
}
