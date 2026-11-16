using System.Collections.Concurrent;
using Azure;
using Azure.Data.Tables;
using Butler.Api.Application.Concurrency;

namespace Butler.Api.Infrastructure.Storage;

/// <summary>
/// In-memory seed/fallback implementation of <see cref="IEntityRepository{TEntity}"/>.
/// It lets the API and the test suite run with no Azurite or cloud storage
/// (Engineering Contract 7.3) while enforcing the same household scoping and
/// optimistic-concurrency rules as the Table-backed store, so behaviour is
/// identical whichever store is wired. State lives only for the process
/// lifetime; register it as a singleton so it is shared across requests.
/// </summary>
/// <typeparam name="TEntity">The Table entity type stored in one table.</typeparam>
public sealed class InMemoryEntityRepository<TEntity> : IEntityRepository<TEntity>
    where TEntity : class, ITableEntity, new()
{
    private readonly ConcurrentDictionary<(string Household, string RowKey), TEntity> _store = new();

    // Serializes every write, so a batch validates and applies against a store no
    // other write can change between its checks and its writes (#319). Reads stay
    // lock-free on the concurrent dictionary.
    private readonly Lock _writeLock = new();

    /// <inheritdoc />
    public Task<TEntity?> GetAsync(string householdId, string rowKey, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(rowKey);

        var found = _store.TryGetValue((householdId, rowKey), out var entity) ? entity : null;
        return Task.FromResult(found);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<TEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        IReadOnlyList<TEntity> results = _store
            .Where(pair => pair.Key.Household == householdId)
            .Select(pair => pair.Value)
            .ToList();
        return Task.FromResult(results);
    }

    /// <inheritdoc />
    public Task AddAsync(string householdId, TEntity entity, CancellationToken cancellationToken = default)
    {
        lock (_writeLock)
        {
            var prepared = Prepare(householdId, entity);
            if (!_store.TryAdd((householdId, prepared.RowKey), prepared))
            {
                throw new InvalidOperationException(
                    $"An entity with RowKey '{prepared.RowKey}' already exists in household '{householdId}'.");
            }
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task UpsertAsync(string householdId, TEntity entity, CancellationToken cancellationToken = default)
    {
        lock (_writeLock)
        {
            var prepared = Prepare(householdId, entity);
            _store[(householdId, prepared.RowKey)] = prepared;
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task UpdateAsync(string householdId, TEntity entity, string? ifMatch, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(entity);
        var validatedIfMatch = OptimisticConcurrency.RequireIfMatch(ifMatch);
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(entity.RowKey);

        lock (_writeLock)
        {
            var current = RequireExisting(householdId, entity.RowKey);
            OptimisticConcurrency.EnsureCurrent(current.ETag.ToString(), validatedIfMatch);

            var prepared = Prepare(householdId, entity);
            _store[(householdId, prepared.RowKey)] = prepared;
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task DeleteAsync(string householdId, string rowKey, string? ifMatch, CancellationToken cancellationToken = default)
    {
        var validatedIfMatch = OptimisticConcurrency.RequireIfMatch(ifMatch);
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(rowKey);

        lock (_writeLock)
        {
            var current = RequireExisting(householdId, rowKey);
            OptimisticConcurrency.EnsureCurrent(current.ETag.ToString(), validatedIfMatch);

            _store.TryRemove((householdId, rowKey), out _);
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    /// <remarks>
    /// Validate-then-apply (#319): every check runs before any write, under the
    /// write lock, so a failing operation leaves the store exactly as it was.
    /// </remarks>
    public Task SubmitBatchAsync(
        string householdId,
        IReadOnlyList<EntityBatchOperation<TEntity>> operations,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentNullException.ThrowIfNull(operations);

        // Argument and If-Match checks need no store state (428 before 412).
        var ifMatches = new string?[operations.Count];
        for (var i = 0; i < operations.Count; i++)
        {
            var operation = operations[i];
            ArgumentNullException.ThrowIfNull(operation);
            ArgumentNullException.ThrowIfNull(operation.Entity);
            ArgumentException.ThrowIfNullOrWhiteSpace(operation.Entity.RowKey);
            if (operation.Kind == EntityBatchOperationKind.Update)
            {
                ifMatches[i] = OptimisticConcurrency.RequireIfMatch(operation.IfMatch);
            }
        }

        lock (_writeLock)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (var i = 0; i < operations.Count; i++)
            {
                var rowKey = operations[i].Entity.RowKey;
                if (!seen.Add(rowKey))
                {
                    throw new InvalidOperationException(
                        $"RowKey '{rowKey}' appears more than once in the batch for household '{householdId}'.");
                }

                if (ifMatches[i] is { } ifMatch)
                {
                    var current = RequireExisting(householdId, rowKey);
                    OptimisticConcurrency.EnsureCurrent(current.ETag.ToString(), ifMatch);
                }
                else
                {
                    ThrowIfExists(householdId, rowKey);
                }
            }

            // Every check passed: apply the whole batch.
            foreach (var operation in operations)
            {
                var prepared = Prepare(householdId, operation.Entity);
                _store[(householdId, prepared.RowKey)] = prepared;
            }
        }

        return Task.CompletedTask;
    }

    // Scopes the entity to the household and stamps a fresh ETag, mirroring the
    // new version the Table service would assign on every write.
    private static TEntity Prepare(string householdId, TEntity entity)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentNullException.ThrowIfNull(entity);
        ArgumentException.ThrowIfNullOrWhiteSpace(entity.RowKey);

        entity.PartitionKey = householdId;
        entity.ETag = new ETag(Guid.NewGuid().ToString("N"));
        return entity;
    }

    // An add never overwrites: an existing RowKey is a conflict, as in Table storage.
    private void ThrowIfExists(string householdId, string rowKey)
    {
        if (_store.ContainsKey((householdId, rowKey)))
        {
            throw new InvalidOperationException(
                $"An entity with RowKey '{rowKey}' already exists in household '{householdId}'.");
        }
    }

    private TEntity RequireExisting(string householdId, string rowKey)
    {
        if (!_store.TryGetValue((householdId, rowKey), out var current))
        {
            // The version the caller intended to replace no longer exists.
            throw new PreconditionFailedException();
        }

        return current;
    }
}
