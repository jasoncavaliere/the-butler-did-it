using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.Storage;

/// <summary>
/// Resolves a <see cref="TableClient"/> for a named table from configuration, so
/// no feature has to know how the connection is established. Locally that is a
/// connection string (Azurite); in deployed environments it is the storage
/// account reached with managed identity. This is the seam every Table-backed
/// repository is built on (Engineering Contract 7.3).
/// </summary>
public interface ITableClientFactory
{
    /// <summary>
    /// Returns a configured client for <paramref name="tableName"/>. Construction
    /// is lazy: no network call is made until the client is first used.
    /// </summary>
    /// <param name="tableName">The Table Storage table name (for example <c>Households</c>).</param>
    TableClient GetTableClient(string tableName);
}
