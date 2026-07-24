using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Infrastructure.Carts;

/// <summary>
/// <see cref="ICartItemRepository"/> on the shared F3 Table access seam
/// (<see cref="IEntityRepository{TEntity}"/>). It delegates to the generic
/// household-scoped repository, so every operation is keyed by
/// <c>PartitionKey = householdId</c> and an item is addressed by its
/// <c>{cartWeekIso}_{itemId}</c> row key within that partition (Engineering
/// Contract 7.3). A week's listing filters the partition on that row-key prefix
/// and orders the result, so it never reads outside the household and never
/// depends on the backing store's natural iteration order.
/// </summary>
public sealed class TableCartItemRepository : ICartItemRepository
{
    private readonly IEntityRepository<CartItemEntity> _items;

    public TableCartItemRepository(IEntityRepository<CartItemEntity> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        _items = items;
    }

    /// <inheritdoc />
    public Task AddAsync(string householdId, CartItemEntity item, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentException.ThrowIfNullOrWhiteSpace(item.RowKey);
        return _items.AddAsync(householdId, item, cancellationToken);
    }

    /// <inheritdoc />
    public Task<CartItemEntity?> GetAsync(string householdId, string rowKey, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(rowKey);
        return _items.GetAsync(householdId, rowKey, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<CartItemEntity>> ListForWeekAsync(
        string householdId,
        string weekIso,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(weekIso);

        var prefix = CartItemEntity.RowKeyPrefixFor(weekIso);
        var all = await _items.ListAsync(householdId, cancellationToken).ConfigureAwait(false);

        return all
            .Where(item => item.RowKey.StartsWith(prefix, StringComparison.Ordinal))
            .OrderBy(item => item.RowKey, StringComparer.Ordinal)
            .ToList();
    }
}
