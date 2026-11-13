using Microsoft.Extensions.Logging;

namespace Butler.Api.Tests.TestSupport;

/// <summary>
/// A minimal <see cref="ILogger{TCategoryName}"/> that records every entry
/// (level, event id, formatted message, exception) so tests can assert what was
/// logged. Every level is enabled. Thread-safe for a host that logs from
/// several threads.
/// </summary>
/// <typeparam name="T">The logger category.</typeparam>
public sealed class CapturingLogger<T> : ILogger<T>
{
    private readonly List<CapturedLogEntry> _entries = [];
    private readonly Lock _gate = new();

    /// <summary>A snapshot of the entries logged so far.</summary>
    public IReadOnlyList<CapturedLogEntry> Entries
    {
        get
        {
            lock (_gate)
            {
                return [.. _entries];
            }
        }
    }

    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        ArgumentNullException.ThrowIfNull(formatter);
        var entry = new CapturedLogEntry(logLevel, eventId, formatter(state, exception), exception);
        lock (_gate)
        {
            _entries.Add(entry);
        }
    }
}

/// <summary>One entry recorded by <see cref="CapturingLogger{T}"/>.</summary>
public sealed record CapturedLogEntry(LogLevel Level, EventId EventId, string Message, Exception? Exception);
