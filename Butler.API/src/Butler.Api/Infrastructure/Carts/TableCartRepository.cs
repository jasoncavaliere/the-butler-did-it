using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Infrastructure.Carts;

/// <summary>
/// <see cref="ICartRepository"/> on the shared F3 Table access seam
/// (<see cref="IEntityRepository{TEntity}"/>). It delegates to the generic
/// household-scoped repository, so every operation is keyed by
/// <c>PartitionKey = householdId</c> and a cart is addressed by its
/// <c>weekIso</c> row key within that partition (Engineering Contract 7.3).
/// Optimistic concurrency is not re-implemented here - the shared helper behind
/// the seam is what turns a missing <c>If-Match</c> into a <c>428</c> and a stale
/// one into a <c>412</c>.
/// </summary>
public sealed class TableCartRepository : ICartRepository
{
    private readonly IEntityRepository<CartEntity> _carts;

    public TableCartRepository(IEntityRepository<CartEntity> carts)
    {
        ArgumentNullException.ThrowIfNull(carts);
        _carts = carts;
    }

    /// <inheritdoc />
    public Task<CartEntity?> GetAsync(string householdId, string weekIso, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(weekIso);
        return _carts.GetAsync(householdId, weekIso, cancellationToken);
    }

    /// <inheritdoc />
    public Task AddAsync(string householdId, CartEntity cart, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(cart);
        ArgumentException.ThrowIfNullOrWhiteSpace(cart.RowKey);
        return _carts.AddAsync(householdId, cart, cancellationToken);
    }

    /// <inheritdoc />
    public Task UpdateAsync(string householdId, CartEntity cart, string? ifMatch, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(cart);
        ArgumentException.ThrowIfNullOrWhiteSpace(cart.RowKey);
        return _carts.UpdateAsync(householdId, cart, ifMatch, cancellationToken);
    }
}
