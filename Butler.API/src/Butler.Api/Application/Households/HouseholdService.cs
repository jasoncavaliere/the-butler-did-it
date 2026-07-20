using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.People;
using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Application.Households;

/// <summary>
/// Default <see cref="IHouseholdService"/>. Creating a household is the root
/// aggregate write: it persists the <c>Households</c> row and the owning
/// organizer's <c>People</c> row together, then re-reads the household so the
/// returned <c>ETag</c> is the persisted one regardless of the backing store.
/// </summary>
public sealed class HouseholdService : IHouseholdService
{
    private const string DefaultOrganizerDisplayName = "Organizer";

    private readonly IHouseholdRepository _households;
    private readonly IEntityRepository<PersonEntity> _people;
    private readonly TimeProvider _timeProvider;

    public HouseholdService(
        IHouseholdRepository households,
        IEntityRepository<PersonEntity> people,
        TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(households);
        ArgumentNullException.ThrowIfNull(people);
        ArgumentNullException.ThrowIfNull(timeProvider);
        _households = households;
        _people = people;
        _timeProvider = timeProvider;
    }

    /// <inheritdoc />
    public async Task<HouseholdResponse> CreateAsync(
        string name,
        string organizerObjectId,
        string? organizerDisplayName,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(organizerObjectId);

        var householdId = NewId();
        var household = new HouseholdEntity
        {
            PartitionKey = householdId,
            RowKey = householdId,
            Name = name,
            OrganizerObjectId = organizerObjectId,
            CreatedUtc = _timeProvider.GetUtcNow(),
        };

        await _households.AddAsync(household, cancellationToken).ConfigureAwait(false);

        // Seed the organizer's roster row in the same operation so the household is
        // never left without an owner (H3 depends on this root person existing).
        var organizer = new PersonEntity
        {
            PartitionKey = householdId,
            RowKey = NewId(),
            DisplayName = string.IsNullOrWhiteSpace(organizerDisplayName)
                ? DefaultOrganizerDisplayName
                : organizerDisplayName,
            Role = OrganizerAuthorization.OrganizerRole,
            IsChild = false,
            OrganizerObjectId = organizerObjectId,
        };

        await _people.AddAsync(householdId, organizer, cancellationToken).ConfigureAwait(false);

        // Re-read so the response ETag is the persisted version, not whatever the
        // in-memory or Table write happened to leave on the local instance.
        var created = await _households.GetAsync(householdId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException(
                $"Household '{householdId}' was created but could not be read back.");

        return Map(created);
    }

    /// <inheritdoc />
    public async Task<HouseholdResponse?> GetAsync(string householdId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        var household = await _households.GetAsync(householdId, cancellationToken).ConfigureAwait(false);
        return household is null ? null : Map(household);
    }

    private static HouseholdResponse Map(HouseholdEntity entity) => new(
        entity.RowKey,
        entity.Name,
        entity.OrganizerObjectId,
        entity.CreatedUtc,
        entity.ETag.ToString());

    // Server-generated, opaque, collision-resistant id (Contract 7.3 keys).
    private static string NewId() => Guid.NewGuid().ToString("N");
}
