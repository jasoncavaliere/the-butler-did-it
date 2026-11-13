using Azure.Data.Tables;
using Butler.Api.Application.Concurrency;
using Butler.Api.Infrastructure.Assignments;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Chores;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.People;
using Butler.Api.Infrastructure.Rooms;
using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Infrastructure.Demo;

/// <summary>
/// Default <see cref="IDemoHouseholdPurger"/>. For each household-owned table it
/// lists the household's partition and deletes every row under the wildcard
/// <c>If-Match</c>, so a concurrent write never blocks the wipe. It takes no
/// <c>HubDevices</c> repository: paired devices survive a re-seed by design.
/// </summary>
public sealed class DemoHouseholdPurger : IDemoHouseholdPurger
{
    private readonly IEntityRepository<HouseholdEntity> _households;
    private readonly IEntityRepository<PersonEntity> _people;
    private readonly IEntityRepository<RoomEntity> _rooms;
    private readonly IEntityRepository<ChoreEntity> _chores;
    private readonly IEntityRepository<AssignmentEntity> _assignments;
    private readonly IEntityRepository<ChoreCompletionEntity> _completions;
    private readonly IEntityRepository<CartEntity> _carts;
    private readonly IEntityRepository<CartItemEntity> _cartItems;

    public DemoHouseholdPurger(
        IEntityRepository<HouseholdEntity> households,
        IEntityRepository<PersonEntity> people,
        IEntityRepository<RoomEntity> rooms,
        IEntityRepository<ChoreEntity> chores,
        IEntityRepository<AssignmentEntity> assignments,
        IEntityRepository<ChoreCompletionEntity> completions,
        IEntityRepository<CartEntity> carts,
        IEntityRepository<CartItemEntity> cartItems)
    {
        ArgumentNullException.ThrowIfNull(households);
        ArgumentNullException.ThrowIfNull(people);
        ArgumentNullException.ThrowIfNull(rooms);
        ArgumentNullException.ThrowIfNull(chores);
        ArgumentNullException.ThrowIfNull(assignments);
        ArgumentNullException.ThrowIfNull(completions);
        ArgumentNullException.ThrowIfNull(carts);
        ArgumentNullException.ThrowIfNull(cartItems);
        _households = households;
        _people = people;
        _rooms = rooms;
        _chores = chores;
        _assignments = assignments;
        _completions = completions;
        _carts = carts;
        _cartItems = cartItems;
    }

    /// <inheritdoc />
    public async Task<int> PurgeAsync(string householdId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        // Children first, the household row last, so a wipe that fails part way
        // never leaves rows behind a household that is already gone.
        var deleted = 0;
        deleted += await PurgeTableAsync(_cartItems, householdId, cancellationToken).ConfigureAwait(false);
        deleted += await PurgeTableAsync(_carts, householdId, cancellationToken).ConfigureAwait(false);
        deleted += await PurgeTableAsync(_completions, householdId, cancellationToken).ConfigureAwait(false);
        deleted += await PurgeTableAsync(_assignments, householdId, cancellationToken).ConfigureAwait(false);
        deleted += await PurgeTableAsync(_chores, householdId, cancellationToken).ConfigureAwait(false);
        deleted += await PurgeTableAsync(_rooms, householdId, cancellationToken).ConfigureAwait(false);
        deleted += await PurgeTableAsync(_people, householdId, cancellationToken).ConfigureAwait(false);
        deleted += await PurgeTableAsync(_households, householdId, cancellationToken).ConfigureAwait(false);
        return deleted;
    }

    private static async Task<int> PurgeTableAsync<TEntity>(
        IEntityRepository<TEntity> repository,
        string householdId,
        CancellationToken cancellationToken)
        where TEntity : class, ITableEntity, new()
    {
        var rows = await repository.ListAsync(householdId, cancellationToken).ConfigureAwait(false);
        foreach (var row in rows)
        {
            await repository
                .DeleteAsync(householdId, row.RowKey, OptimisticConcurrency.Wildcard, cancellationToken)
                .ConfigureAwait(false);
        }

        return rows.Count;
    }
}
