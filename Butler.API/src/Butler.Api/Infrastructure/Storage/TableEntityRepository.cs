using Azure;
using Azure.Data.Tables;
using Butler.Api.Application.Concurrency;
using Microsoft.AspNetCore.Http;

namespace Butler.Api.Infrastructure.Storage;

/// <summary>
/// Azure Table Storage implementation of <see cref="IEntityRepository{TEntity}"/>.
/// Every operation is scoped to a household via <c>PartitionKey = householdId</c>
/// (Engineering Contract 7.3), and mutations flow through the shared
/// optimistic-concurrency rules: a missing <c>If-Match</c> is rejected before the
/// service is called (<c>428</c>), and a stale one surfaces as <c>412</c> by
/// translating the Table service's precondition failure.
/// </summary>
/// <typeparam name="TEntity">The Table entity type stored in one table.</typeparam>
public sealed class TableEntityRepository<TEntity> : IEntityRepository<TEntity>
    where TEntity : class, ITableEntity, new()
{
    private readonly TableClient _table;

    public TableEntityRepository(TableClient table)
    {
        ArgumentNullException.ThrowIfNull(table);
        _table = table;
    }

    /// <inheritdoc />
    public async Task<TEntity?> GetAsync(string householdId, string rowKey, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(rowKey);

        var response = await _table
            .GetEntityIfExistsAsync<TEntity>(householdId, rowKey, cancellationToken: cancellationToken)
            .ConfigureAwait(false);
        return response.HasValue ? response.Value : null;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<TEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        var results = new List<TEntity>();
        var query = _table.QueryAsync<TEntity>(
            entity => entity.PartitionKey == householdId,
            cancellationToken: cancellationToken);
        await foreach (var entity in query.ConfigureAwait(false))
        {
            results.Add(entity);
        }

        return results;
    }

    /// <inheritdoc />
    public async Task AddAsync(string householdId, TEntity entity, CancellationToken cancellationToken = default)
    {
        Scope(householdId, entity);
        await _table.AddEntityAsync(entity, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task UpsertAsync(string householdId, TEntity entity, CancellationToken cancellationToken = default)
    {
        Scope(householdId, entity);
        await _table.UpsertEntityAsync(entity, TableUpdateMode.Replace, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task UpdateAsync(string householdId, TEntity entity, string? ifMatch, CancellationToken cancellationToken = default)
    {
        var validatedIfMatch = OptimisticConcurrency.RequireIfMatch(ifMatch);
        Scope(householdId, entity);

        try
        {
            await _table
                .UpdateEntityAsync(entity, new ETag(validatedIfMatch), TableUpdateMode.Replace, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (RequestFailedException ex) when (IsPreconditionFailure(ex))
        {
            throw new PreconditionFailedException();
        }
    }

    /// <inheritdoc />
    public async Task DeleteAsync(string householdId, string rowKey, string? ifMatch, CancellationToken cancellationToken = default)
    {
        var validatedIfMatch = OptimisticConcurrency.RequireIfMatch(ifMatch);
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(rowKey);

        try
        {
            await _table
                .DeleteEntityAsync(householdId, rowKey, new ETag(validatedIfMatch), cancellationToken)
                .ConfigureAwait(false);
        }
        catch (RequestFailedException ex) when (IsPreconditionFailure(ex))
        {
            throw new PreconditionFailedException();
        }
    }

    // A stale ETag surfaces as 412; a vanished entity surfaces as 404. Both mean
    // the version the caller intended to change is no longer current, so both map
    // to the shared 412 precondition-failed contract.
    private static bool IsPreconditionFailure(RequestFailedException ex) =>
        ex.Status is StatusCodes.Status412PreconditionFailed or StatusCodes.Status404NotFound;

    private static void Scope(string householdId, TEntity entity)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentNullException.ThrowIfNull(entity);
        entity.PartitionKey = householdId;
    }
}
