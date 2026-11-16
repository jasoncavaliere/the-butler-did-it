using Azure.Data.Tables;

namespace Butler.Api.Infrastructure.Storage;

/// <summary>
/// The kind of write one <see cref="EntityBatchOperation{TEntity}"/> carries in an
/// all-or-nothing <see cref="IEntityRepository{TEntity}.SubmitBatchAsync"/> call
/// (#319).
/// </summary>
public enum EntityBatchOperationKind
{
    /// <summary>Insert a new row; fails when the <c>RowKey</c> already exists.</summary>
    Add,

    /// <summary>
    /// Replace an existing row under optimistic concurrency; requires
    /// <see cref="EntityBatchOperation{TEntity}.IfMatch"/>.
    /// </summary>
    Update,
}

/// <summary>
/// One write in an all-or-nothing batch submitted through
/// <see cref="IEntityRepository{TEntity}.SubmitBatchAsync"/> (#319). An
/// <see cref="EntityBatchOperationKind.Update"/> carries the <c>If-Match</c>
/// version it replaces; an <see cref="EntityBatchOperationKind.Add"/> ignores it.
/// </summary>
/// <typeparam name="TEntity">The Table entity type stored in one table.</typeparam>
/// <param name="Kind">Whether the entity is added or replaced.</param>
/// <param name="Entity">The entity to write.</param>
/// <param name="IfMatch">The version an update replaces (<c>*</c> for any).</param>
public sealed record EntityBatchOperation<TEntity>(
    EntityBatchOperationKind Kind,
    TEntity Entity,
    string? IfMatch = null)
    where TEntity : class, ITableEntity, new();
