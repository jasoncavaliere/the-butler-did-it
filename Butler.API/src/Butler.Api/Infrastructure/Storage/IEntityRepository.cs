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
}
