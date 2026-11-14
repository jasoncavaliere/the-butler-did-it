using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Infrastructure.Events;

/// <summary>
/// <see cref="IEventRepository"/> on the shared F3 Table access seam
/// (<see cref="IEntityRepository{TEntity}"/>). It delegates to the generic
/// household-scoped repository, so every operation is keyed by
/// <c>PartitionKey = householdId</c> (Engineering Contract 7.3).
/// </summary>
public sealed class TableEventRepository : IEventRepository
{
    private readonly IEntityRepository<EventEntity> _events;

    public TableEventRepository(IEntityRepository<EventEntity> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        _events = events;
    }

    /// <inheritdoc />
    public Task AddAsync(string householdId, EventEntity entity, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentNullException.ThrowIfNull(entity);
        ArgumentException.ThrowIfNullOrWhiteSpace(entity.RowKey);
        return _events.AddAsync(householdId, entity, cancellationToken);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<EventEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        return _events.ListAsync(householdId, cancellationToken);
    }
}
