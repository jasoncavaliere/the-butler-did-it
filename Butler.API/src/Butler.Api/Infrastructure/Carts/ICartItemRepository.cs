namespace Butler.Api.Infrastructure.Carts;

/// <summary>
/// Persistence seam for the <c>CartItems</c> table (Engineering Contract 7.3),
/// built on the shared F3 Table access layer. Every operation is scoped to a
/// single household by <c>PartitionKey = householdId</c>; there is no
/// cross-household query. Items are addressed by the
/// <c>{cartWeekIso}_{itemId}</c> composite row key, so one week's lines are a
/// contiguous range within the household's partition.
/// </summary>
public interface ICartItemRepository
{
    /// <summary>
    /// Adds an item to the household's partition. The entity's <c>RowKey</c> must
    /// already be the <c>{cartWeekIso}_{itemId}</c> composite (build it with
    /// <see cref="CartItemEntity.RowKeyFor"/>).
    /// </summary>
    Task AddAsync(string householdId, CartItemEntity item, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the item with the given <paramref name="rowKey"/>
    /// (<c>{cartWeekIso}_{itemId}</c>) in the household, or <c>null</c> when no
    /// such item exists.
    /// </summary>
    Task<CartItemEntity?> GetAsync(string householdId, string rowKey, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns the household's items for one week's cart, ordered by row key so
    /// the listing is deterministic whichever store is wired.
    /// </summary>
    Task<IReadOnlyList<CartItemEntity>> ListForWeekAsync(
        string householdId,
        string weekIso,
        CancellationToken cancellationToken = default);
}
