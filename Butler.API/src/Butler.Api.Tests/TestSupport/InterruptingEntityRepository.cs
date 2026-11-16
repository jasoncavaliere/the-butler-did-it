using Azure.Data.Tables;
using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Tests.TestSupport;

/// <summary>
/// Test-only <see cref="IEntityRepository{TEntity}"/> decorator that simulates a
/// storage write failing part way through persisting a set of rows (#319). When
/// <see cref="RowsBeforeInterrupt"/> is armed, the decorator counts the rows it
/// has written and throws an <see cref="IOException"/> on the first write that
/// would take the count past the limit, before forwarding it. Single-row writes
/// (Add, Upsert, Update) count one row each; a batch counts every operation it
/// carries. A batch is one request that the Table service commits whole or not at
/// all, so a batch that would cross the limit is refused in full, exactly as a
/// lost transaction request would be. Reads and deletes always pass through.
/// </summary>
/// <typeparam name="TEntity">The Table entity type stored in one table.</typeparam>
public sealed class InterruptingEntityRepository<TEntity> : IEntityRepository<TEntity>
    where TEntity : class, ITableEntity, new()
{
    private readonly IEntityRepository<TEntity> _inner;
    private readonly object _sync = new();
    private int _written;
    private int? _rowsBeforeInterrupt;

    public InterruptingEntityRepository(IEntityRepository<TEntity> inner)
    {
        ArgumentNullException.ThrowIfNull(inner);
        _inner = inner;
    }

    /// <summary>
    /// The number of rows the decorator lets through before it interrupts;
    /// <c>null</c> disarms it. Setting it resets the written-row count.
    /// </summary>
    public int? RowsBeforeInterrupt
    {
        get
        {
            lock (_sync)
            {
                return _rowsBeforeInterrupt;
            }
        }

        set
        {
            lock (_sync)
            {
                _rowsBeforeInterrupt = value;
                _written = 0;
            }
        }
    }

    /// <inheritdoc />
    public Task<TEntity?> GetAsync(string householdId, string rowKey, CancellationToken cancellationToken = default) =>
        _inner.GetAsync(householdId, rowKey, cancellationToken);

    /// <inheritdoc />
    public Task<IReadOnlyList<TEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default) =>
        _inner.ListAsync(householdId, cancellationToken);

    /// <inheritdoc />
    public Task AddAsync(string householdId, TEntity entity, CancellationToken cancellationToken = default)
    {
        Count(1);
        return _inner.AddAsync(householdId, entity, cancellationToken);
    }

    /// <inheritdoc />
    public Task UpsertAsync(string householdId, TEntity entity, CancellationToken cancellationToken = default)
    {
        Count(1);
        return _inner.UpsertAsync(householdId, entity, cancellationToken);
    }

    /// <inheritdoc />
    public Task UpdateAsync(string householdId, TEntity entity, string? ifMatch, CancellationToken cancellationToken = default)
    {
        Count(1);
        return _inner.UpdateAsync(householdId, entity, ifMatch, cancellationToken);
    }

    /// <inheritdoc />
    public Task DeleteAsync(string householdId, string rowKey, string? ifMatch, CancellationToken cancellationToken = default) =>
        _inner.DeleteAsync(householdId, rowKey, ifMatch, cancellationToken);

    /// <inheritdoc />
    public Task SubmitBatchAsync(
        string householdId,
        IReadOnlyList<EntityBatchOperation<TEntity>> operations,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(operations);
        Count(operations.Count);
        return _inner.SubmitBatchAsync(householdId, operations, cancellationToken);
    }

    // Throws before forwarding when this write would cross the armed limit.
    private void Count(int rows)
    {
        lock (_sync)
        {
            if (_rowsBeforeInterrupt is { } limit && _written + rows > limit)
            {
                throw new IOException("Simulated storage interruption");
            }

            _written += rows;
        }
    }
}
