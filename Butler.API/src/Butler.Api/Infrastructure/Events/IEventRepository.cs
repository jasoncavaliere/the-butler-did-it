namespace Butler.Api.Infrastructure.Events;

/// <summary>
/// Persistence seam for usage events (#122), built on the shared F3 Table access
/// layer. It is append-only: events are added and listed, never updated or
/// deleted here. Every operation is scoped to one household by
/// <c>PartitionKey = householdId</c>.
/// </summary>
public interface IEventRepository
{
    /// <summary>
    /// Appends an <c>Events</c> row to the household's partition. The entity's
    /// <c>RowKey</c> must already be set.
    /// </summary>
    Task AddAsync(string householdId, EventEntity entity, CancellationToken cancellationToken = default);

    /// <summary>Returns every event in the household's partition.</summary>
    Task<IReadOnlyList<EventEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default);
}
