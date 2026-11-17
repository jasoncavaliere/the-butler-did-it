using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.Storage;

/// <summary>
/// The minimal persistence base every data feature builds on: entity CRUD always
/// scoped to a household (<c>PartitionKey = householdId</c>, Engineering Contract
/// 7.3) with optimistic concurrency on mutations. There is no cross-household
/// query - the household id is a required argument on every call. Two
/// implementations exist: a Table Storage one and an in-memory seed/fallback one;
/// callers depend only on this interface.
/// </summary>
/// <typeparam name="TEntity">The Table entity type stored in one table.</typeparam>
public interface IEntityRepository<TEntity>
    where TEntity : class, ITableEntity, new()
{
    /// <summary>
    /// Returns the entity with <paramref name="rowKey"/> in the household, or
    /// <c>null</c> if it does not exist. The returned entity carries its current
    /// <c>ETag</c> for a later optimistic update.
    /// </summary>
    Task<TEntity?> GetAsync(string householdId, string rowKey, CancellationToken cancellationToken = default);

    /// <summary>Returns every entity in the household's partition.</summary>
    Task<IReadOnlyList<TEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Adds a new entity to the household's partition. Sets
    /// <c>PartitionKey = householdId</c> before writing.
    /// </summary>
    Task AddAsync(string householdId, TEntity entity, CancellationToken cancellationToken = default);

    /// <summary>
    /// Inserts or replaces the entity in the household's partition (no
    /// concurrency check). Sets <c>PartitionKey = householdId</c> before writing.
    /// </summary>
    Task UpsertAsync(string householdId, TEntity entity, CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces the entity under optimistic concurrency. <paramref name="ifMatch"/>
    /// is required (<c>428</c> when missing) and must match the stored version
    /// (<c>412</c> when stale). Sets <c>PartitionKey = householdId</c> before
    /// writing.
    /// </summary>
    Task UpdateAsync(string householdId, TEntity entity, string? ifMatch, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes the entity under optimistic concurrency. <paramref name="ifMatch"/>
    /// is required (<c>428</c> when missing) and must match the stored version
    /// (<c>412</c> when stale).
    /// </summary>
    Task DeleteAsync(string householdId, string rowKey, string? ifMatch, CancellationToken cancellationToken = default);

    /// <summary>
    /// Writes every operation in the household's partition (#319). The write is
    /// all-or-nothing per chunk of up to 100 operations: the Table store submits
    /// one entity-group transaction per 100 operations, so a batch of up to 100 is
    /// applied whole or not at all, and a larger batch can be left partly applied
    /// when a later chunk fails (the in-memory store applies any batch whole). An
    /// <see cref="EntityBatchOperationKind.Add"/> fails when its <c>RowKey</c>
    /// already exists; an <see cref="EntityBatchOperationKind.Update"/> requires
    /// <see cref="EntityBatchOperation{TEntity}.IfMatch"/> (<c>428</c> when
    /// missing) and fails with <c>412</c> when the stored version is stale or has
    /// vanished. A <c>RowKey</c> may appear at most once per batch. An empty list
    /// is a no-op. Sets <c>PartitionKey = householdId</c> on every entity.
    /// </summary>
    Task SubmitBatchAsync(
        string householdId,
        IReadOnlyList<EntityBatchOperation<TEntity>> operations,
        CancellationToken cancellationToken = default);
}
