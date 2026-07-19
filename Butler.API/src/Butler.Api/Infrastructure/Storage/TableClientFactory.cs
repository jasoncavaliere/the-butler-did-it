using Azure.Core;
using Azure.Data.Tables;
using Azure.Identity;
using Microsoft.Extensions.Options;

namespace Butler.Api.Infrastructure.Storage;

/// <summary>
/// Default <see cref="ITableClientFactory"/>. Prefers a configured connection
/// string (local/Azurite); otherwise reaches the storage account with
/// <see cref="DefaultAzureCredential"/> (managed identity in deployed
/// environments). Throws when neither is configured, since a caller only reaches
/// this factory when the in-memory fallback was not selected.
/// </summary>
public sealed class TableClientFactory : ITableClientFactory
{
    private readonly StorageOptions _options;
    private readonly TokenCredential _credential;

    public TableClientFactory(IOptions<StorageOptions> options)
        : this(options, new DefaultAzureCredential())
    {
    }

    // Credential is injectable so tests exercise the managed-identity path
    // without standing up a real DefaultAzureCredential chain.
    internal TableClientFactory(IOptions<StorageOptions> options, TokenCredential credential)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options.Value;
        _credential = credential;
    }

    /// <inheritdoc />
    public TableClient GetTableClient(string tableName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tableName);

        if (!string.IsNullOrWhiteSpace(_options.ConnectionString))
        {
            return new TableClient(_options.ConnectionString, tableName);
        }

        var serviceUri = ResolveServiceUri();
        return new TableClient(new Uri(serviceUri, UriKind.Absolute), tableName, _credential);
    }

    private string ResolveServiceUri()
    {
        if (!string.IsNullOrWhiteSpace(_options.TableServiceUri))
        {
            return _options.TableServiceUri;
        }

        if (!string.IsNullOrWhiteSpace(_options.AccountName))
        {
            return $"https://{_options.AccountName}.table.core.windows.net";
        }

        throw new InvalidOperationException(
            "No storage connection is configured. Set Storage:ConnectionString, "
            + "Storage:AccountName, or Storage:TableServiceUri - or set "
            + "Storage:UseInMemoryStore to true to use the in-memory fallback.");
    }
}
