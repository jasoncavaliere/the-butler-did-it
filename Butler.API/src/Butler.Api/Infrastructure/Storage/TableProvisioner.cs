using System.Globalization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Butler.Api.Infrastructure.Storage;

/// <summary>
/// Creates every table registered through
/// <see cref="StorageServiceCollectionExtensions.AddTableRepository{TEntity}"/>
/// when the API runs on Table Storage (#91), so the first write to a feature
/// table against a fresh account succeeds with no manual setup. Creation is
/// idempotent (<c>CreateIfNotExists</c>), so restarting against existing tables
/// is a no-op. In in-memory mode it does nothing and never resolves the client
/// factory. A table that cannot be created is logged by name and the exception
/// is rethrown, so startup fails fast. The whole pass is bounded by
/// <see cref="StorageOptions.ResolveProvisioningTimeout"/> (measured on the
/// injected <see cref="TimeProvider"/>): when it expires, the table in flight is
/// logged by name and a <see cref="TimeoutException"/> fails startup instead of
/// waiting out the Azure SDK retry window against an unreachable endpoint (#174).
/// A configured bound above <see cref="StorageOptions.MaxProvisioningTimeout"/>
/// is clamped and logged as a warning (#256).
/// </summary>
public sealed partial class TableProvisioner
{
    private readonly StorageOptions _options;
    private readonly IServiceProvider _services;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<TableProvisioner> _logger;

    public TableProvisioner(
        IOptions<StorageOptions> options,
        IEnumerable<TableRegistration> registrations,
        IServiceProvider services,
        TimeProvider timeProvider,
        ILogger<TableProvisioner> logger)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(registrations);
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(logger);

        _options = options.Value;
        _services = services;
        _timeProvider = timeProvider;
        _logger = logger;
        TableNames = registrations
            .Select(registration => registration.TableName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    /// <summary>
    /// The distinct registered table names (case-insensitive), in registration order.
    /// </summary>
    public IReadOnlyList<string> TableNames { get; }

    /// <summary>
    /// Creates each of <see cref="TableNames"/> if it does not exist yet. Does
    /// nothing in in-memory mode. Safe to call more than once. The whole pass must
    /// finish within <see cref="StorageOptions.ResolveProvisioningTimeout"/>;
    /// a warning is logged when that bound was clamped to the ceiling.
    /// </summary>
    /// <param name="cancellationToken">Cancels the provisioning.</param>
    /// <exception cref="TimeoutException">
    /// The bound expired before every table was created; the message names the
    /// table in flight.
    /// </exception>
    public async Task ProvisionAsync(CancellationToken cancellationToken = default)
    {
        if (_options.ResolveUseInMemory())
        {
            LogSkippedInMemory(_logger);
            return;
        }

        // Resolved lazily: the default factory builds a DefaultAzureCredential,
        // which in-memory mode must never construct.
        var factory = _services.GetRequiredService<ITableClientFactory>();

        // One deadline for the whole pass, so startup fails within the bound no
        // matter how many tables there are. The linked token cancels the SDK call
        // (which would otherwise keep retrying); WaitAsync abandons a call that
        // ignores its token.
        var timeout = _options.ResolveProvisioningTimeout();
        if (_options.ProvisioningTimeout is { } configured && _options.IsProvisioningTimeoutClamped())
        {
            LogProvisioningTimeoutClamped(_logger, configured, timeout);
        }

        using var deadline = new CancellationTokenSource(timeout, _timeProvider);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, deadline.Token);
        foreach (var tableName in TableNames)
        {
            try
            {
                var client = factory.GetTableClient(tableName);
                await client.CreateIfNotExistsAsync(linked.Token).WaitAsync(linked.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException ex)
                when (deadline.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
            {
                LogTableCreationTimedOut(_logger, ex, timeout, tableName);
                throw new TimeoutException(
                    string.Create(
                        CultureInfo.InvariantCulture,
                        $"Timed out after {timeout} creating Table Storage table {tableName}; raise {StorageOptions.SectionName}:{nameof(StorageOptions.ProvisioningTimeout)} or check that the storage endpoint is reachable."),
                    ex);
            }
            catch (Exception ex)
            {
                LogTableCreationFailed(_logger, ex, tableName);
                throw;
            }
        }

        LogProvisioned(_logger, TableNames.Count, TableNames);
    }

    [LoggerMessage(
        EventId = 9101,
        Level = LogLevel.Information,
        Message = "Provisioned {TableCount} Table Storage tables: {TableNames}")]
    private static partial void LogProvisioned(ILogger logger, int tableCount, IEnumerable<string> tableNames);

    [LoggerMessage(
        EventId = 9102,
        Level = LogLevel.Error,
        Message = "Failed to create Table Storage table {TableName}")]
    private static partial void LogTableCreationFailed(ILogger logger, Exception exception, string tableName);

    [LoggerMessage(
        EventId = 9103,
        Level = LogLevel.Debug,
        Message = "Skipped table provisioning: the in-memory store is in use")]
    private static partial void LogSkippedInMemory(ILogger logger);

    [LoggerMessage(
        EventId = 9104,
        Level = LogLevel.Error,
        Message = "Timed out after {Timeout} creating Table Storage table {TableName}")]
    private static partial void LogTableCreationTimedOut(ILogger logger, Exception exception, TimeSpan timeout, string tableName);

    [LoggerMessage(
        EventId = 9105,
        Level = LogLevel.Warning,
        Message = "Clamped Storage:ProvisioningTimeout {ConfiguredTimeout} to the {MaxTimeout} ceiling; a bare number is read as days, use hh:mm:ss")]
    private static partial void LogProvisioningTimeoutClamped(ILogger logger, TimeSpan configuredTimeout, TimeSpan maxTimeout);
}
