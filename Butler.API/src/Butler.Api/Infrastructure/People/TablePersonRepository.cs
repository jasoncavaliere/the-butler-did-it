using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Infrastructure.People;

/// <summary>
/// <see cref="IPersonRepository"/> on the shared F3 Table access seam
/// (<see cref="IEntityRepository{TEntity}"/>). It delegates to the generic
/// household-scoped repository, so every operation is keyed by
/// <c>PartitionKey = householdId</c> and a person is addressed by their
/// <c>personId</c> within that partition (Engineering Contract 7.3).
/// </summary>
public sealed class TablePersonRepository : IPersonRepository
{
    private readonly IEntityRepository<PersonEntity> _people;

    public TablePersonRepository(IEntityRepository<PersonEntity> people)
    {
        ArgumentNullException.ThrowIfNull(people);
        _people = people;
    }

    /// <inheritdoc />
    public Task AddAsync(string householdId, PersonEntity person, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(person);
        ArgumentException.ThrowIfNullOrWhiteSpace(person.RowKey);
        return _people.AddAsync(householdId, person, cancellationToken);
    }

    /// <inheritdoc />
    public Task<PersonEntity?> GetAsync(string householdId, string personId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(personId);
        return _people.GetAsync(householdId, personId, cancellationToken);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<PersonEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        return _people.ListAsync(householdId, cancellationToken);
    }

    /// <inheritdoc />
    public Task UpdateAsync(string householdId, PersonEntity person, string? ifMatch, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(person);
        ArgumentException.ThrowIfNullOrWhiteSpace(person.RowKey);
        return _people.UpdateAsync(householdId, person, ifMatch, cancellationToken);
    }

    /// <inheritdoc />
    public Task DeleteAsync(string householdId, string personId, string? ifMatch, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(personId);
        return _people.DeleteAsync(householdId, personId, ifMatch, cancellationToken);
    }
}
