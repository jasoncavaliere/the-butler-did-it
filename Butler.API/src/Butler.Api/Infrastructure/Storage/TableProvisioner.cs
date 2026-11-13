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
/// is rethrown, so startup fails fast.
/// </summary>
public sealed partial class TableProvisioner
{
    private readonly StorageOptions _options;
    private readonly IServiceProvider _services;
    private readonly ILogger<TableProvisioner> _logger;

    public TableProvisioner(
        IOptions<StorageOptions> options,
        IEnumerable<TableRegistration> registrations,
        IServiceProvider services,
        ILogger<TableProvisioner> logger)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(registrations);
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(logger);

        _options = options.Value;
        _services = services;
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
    /// nothing in in-memory mode. Safe to call more than once.
    /// </summary>
    /// <param name="cancellationToken">Cancels the provisioning.</param>
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
        foreach (var tableName in TableNames)
        {
            try
            {
                var client = factory.GetTableClient(tableName);
                await client.CreateIfNotExistsAsync(cancellationToken).ConfigureAwait(false);
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
}
