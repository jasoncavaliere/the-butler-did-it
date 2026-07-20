using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Concurrency;
using Butler.Api.Infrastructure.People;

namespace Butler.Api.Application.People;

/// <summary>
/// Default <see cref="IPersonService"/>. People are a household-scoped roster
/// table: create stamps a server-generated id; list applies a deterministic
/// <c>personId</c> ordering; update and delete pre-check existence so an unknown
/// person is a <c>404</c> rather than a concurrency error, and update flows
/// through the shared F3 optimistic-concurrency helper before re-reading so the
/// returned <c>ETag</c> is the persisted one. A demotion or deletion that would
/// leave the household without an organizer is rejected before any write.
/// </summary>
public sealed class PersonService : IPersonService
{
    private readonly IPersonRepository _people;

    public PersonService(IPersonRepository people)
    {
        ArgumentNullException.ThrowIfNull(people);
        _people = people;
    }

    /// <inheritdoc />
    public async Task<PersonResponse> CreateAsync(
        string householdId,
        string displayName,
        string role,
        bool isChild,
        string? claimColor,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(displayName);
        var normalizedRole = NormalizeRole(role);

        var personId = NewId();
        var person = new PersonEntity
        {
            PartitionKey = householdId,
            RowKey = personId,
            DisplayName = displayName,
            Role = normalizedRole,
            IsChild = isChild,
            ClaimColor = claimColor,
        };

        await _people.AddAsync(householdId, person, cancellationToken).ConfigureAwait(false);

        // Re-read so the response ETag is the persisted version, not whatever the
        // in-memory or Table write happened to leave on the local instance.
        var created = await _people.GetAsync(householdId, personId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException(
                $"Person '{personId}' was created but could not be read back.");

        return Map(created);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<PersonResponse>> ListAsync(
        string householdId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        var people = await _people.ListAsync(householdId, cancellationToken).ConfigureAwait(false);

        // Stable, deterministic ordering by personId regardless of the backing
        // store's natural iteration order.
        return people
            .OrderBy(person => person.RowKey, StringComparer.Ordinal)
            .Select(Map)
            .ToList();
    }

    /// <inheritdoc />
    public async Task<PersonResponse?> GetAsync(
        string householdId,
        string personId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(personId);

        var person = await _people.GetAsync(householdId, personId, cancellationToken).ConfigureAwait(false);
        return person is null ? null : Map(person);
    }

    /// <inheritdoc />
    public async Task<PersonResponse?> UpdateAsync(
        string householdId,
        string personId,
        string displayName,
        string role,
        bool isChild,
        string? claimColor,
        string? ifMatch,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(personId);
        ArgumentException.ThrowIfNullOrWhiteSpace(displayName);
        var normalizedRole = NormalizeRole(role);

        // Existence pre-check so an unknown person is a 404, not a 412/428 from the
        // concurrency layer.
        var existing = await _people.GetAsync(householdId, personId, cancellationToken).ConfigureAwait(false);
        if (existing is null)
        {
            return null;
        }

        // Last-organizer guard: refuse to demote the sole remaining organizer,
        // leaving the row unchanged (checked before any write).
        var isDemotingOrganizer =
            IsOrganizer(existing.Role) && !IsOrganizer(normalizedRole);
        if (isDemotingOrganizer)
        {
            await EnsureNotLastOrganizerAsync(householdId, cancellationToken).ConfigureAwait(false);
        }

        existing.DisplayName = displayName;
        existing.Role = normalizedRole;
        existing.IsChild = isChild;
        existing.ClaimColor = claimColor;
        await _people.UpdateAsync(householdId, existing, ifMatch, cancellationToken).ConfigureAwait(false);

        // Re-read so the returned ETag is the persisted post-update version.
        var updated = await _people.GetAsync(householdId, personId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException(
                $"Person '{personId}' was updated but could not be read back.");

        return Map(updated);
    }

    /// <inheritdoc />
    public async Task<bool> DeleteAsync(
        string householdId,
        string personId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(personId);

        var existing = await _people.GetAsync(householdId, personId, cancellationToken).ConfigureAwait(false);
        if (existing is null)
        {
            return false;
        }

        // Last-organizer guard: refuse to delete the sole remaining organizer.
        if (IsOrganizer(existing.Role))
        {
            await EnsureNotLastOrganizerAsync(householdId, cancellationToken).ConfigureAwait(false);
        }

        // Delete is not concurrency-gated (Contract 7.3 scopes If-Match to
        // updates); the wildcard removes the current version unconditionally.
        await _people
            .DeleteAsync(householdId, personId, OptimisticConcurrency.Wildcard, cancellationToken)
            .ConfigureAwait(false);
        return true;
    }

    // Throws when the household has one organizer or fewer, so the caller must not
    // remove or demote the organizer they are acting on.
    private async Task EnsureNotLastOrganizerAsync(string householdId, CancellationToken cancellationToken)
    {
        var people = await _people.ListAsync(householdId, cancellationToken).ConfigureAwait(false);
        var organizerCount = people.Count(person => IsOrganizer(person.Role));
        if (organizerCount <= 1)
        {
            throw new LastOrganizerException();
        }
    }

    // Role is a small closed set (Contract 7.3); anything else is a client error.
    private static string NormalizeRole(string role)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(role);

        if (string.Equals(role, OrganizerAuthorization.OrganizerRole, StringComparison.OrdinalIgnoreCase))
        {
            return OrganizerAuthorization.OrganizerRole;
        }

        if (string.Equals(role, OrganizerAuthorization.ParticipantRole, StringComparison.OrdinalIgnoreCase))
        {
            return OrganizerAuthorization.ParticipantRole;
        }

        throw new ValidationException(
            $"Role must be '{OrganizerAuthorization.OrganizerRole}' or '{OrganizerAuthorization.ParticipantRole}'.");
    }

    private static bool IsOrganizer(string role) =>
        string.Equals(role, OrganizerAuthorization.OrganizerRole, StringComparison.Ordinal);

    private static PersonResponse Map(PersonEntity entity) => new(
        entity.RowKey,
        entity.DisplayName,
        entity.Role,
        entity.IsChild,
        entity.ClaimColor,
        entity.ETag.ToString());

    // Server-generated, opaque, collision-resistant id (Contract 7.3 keys).
    private static string NewId() => Guid.NewGuid().ToString("N");
}
