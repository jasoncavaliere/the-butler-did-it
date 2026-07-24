namespace Butler.Api.Infrastructure.Carts;

/// <summary>
/// Persistence seam for the <c>Carts</c> table (Engineering Contract 7.3), built
/// on the shared F3 Table access layer. Every operation is scoped to a single
/// household by <c>PartitionKey = householdId</c>; there is no cross-household
/// query. A week has exactly one cart row, addressed by its <c>weekIso</c> row
/// key, which is what keeps a confirmed week and a new building cart from ever
/// becoming two rows.
/// </summary>
public interface ICartRepository
{
    /// <summary>
    /// Returns the household's cart for <paramref name="weekIso"/> carrying its
    /// current <c>ETag</c>, or <c>null</c> when the week has no cart yet.
    /// </summary>
    Task<CartEntity?> GetAsync(string householdId, string weekIso, CancellationToken cancellationToken = default);

    /// <summary>
    /// Adds a new cart row to the household's partition. The entity's
    /// <c>RowKey</c> must already be the target <c>weekIso</c>.
    /// </summary>
    Task AddAsync(string householdId, CartEntity cart, CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces a cart under optimistic concurrency - the seam the confirm flow
    /// (G4) flips <see cref="CartEntity.Status"/> on.
    /// <paramref name="ifMatch"/> is required (<c>428</c> when missing) and must
    /// match the stored version (<c>412</c> when stale).
    /// </summary>
    Task UpdateAsync(string householdId, CartEntity cart, string? ifMatch, CancellationToken cancellationToken = default);
}
