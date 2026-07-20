using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Concurrency;
using Butler.Api.Infrastructure.Chores;
using Butler.Api.Infrastructure.Rooms;

namespace Butler.Api.Application.Chores;

/// <summary>
/// Default <see cref="IChoreService"/>. Chores are a household-scoped table whose
/// rows attach to a <c>Room</c> (H2): create stamps a server-generated id and
/// defaults <c>Active</c> to <c>true</c>; list applies a deterministic
/// <c>choreId</c> ordering and an optional <c>Active</c> filter; update and
/// deactivate pre-check existence so an unknown chore is a <c>404</c> rather than
/// a concurrency error, and update flows through the shared F3
/// optimistic-concurrency helper before re-reading so the returned <c>ETag</c> is
/// the persisted one. Create and update validate the room reference, the effort,
/// and the cadence before any write, so a bad request persists no row.
/// Deactivation is preferred over deletion, keeping Epic 40 history referential.
/// </summary>
public sealed class ChoreService : IChoreService
{
    private const string DailyCadence = "Daily";
    private const string WeeklyCadence = "Weekly";

    private readonly IChoreRepository _chores;
    private readonly IRoomRepository _rooms;

    public ChoreService(IChoreRepository chores, IRoomRepository rooms)
    {
        ArgumentNullException.ThrowIfNull(chores);
        ArgumentNullException.ThrowIfNull(rooms);
        _chores = chores;
        _rooms = rooms;
    }

    /// <inheritdoc />
    public async Task<ChoreResponse> CreateAsync(
        string householdId,
        string title,
        string roomId,
        string cadence,
        int effort,
        int? minAge,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(title);

        var normalizedCadence = NormalizeCadence(cadence);
        ValidateEffort(effort);
        await EnsureRoomExistsAsync(householdId, roomId, cancellationToken).ConfigureAwait(false);

        var choreId = NewId();
        var chore = new ChoreEntity
        {
            PartitionKey = householdId,
            RowKey = choreId,
            Title = title,
            RoomId = roomId,
            Cadence = normalizedCadence,
            Effort = effort,
            MinAge = minAge,
            Active = true,
        };

        await _chores.AddAsync(householdId, chore, cancellationToken).ConfigureAwait(false);

        // Re-read so the response ETag is the persisted version, not whatever the
        // in-memory or Table write happened to leave on the local instance.
        var created = await _chores.GetAsync(householdId, choreId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException(
                $"Chore '{choreId}' was created but could not be read back.");

        return Map(created);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ChoreResponse>> ListAsync(
        string householdId,
        bool? active = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        var chores = await _chores.ListAsync(householdId, cancellationToken).ConfigureAwait(false);

        return chores
            .Where(chore => active is null || chore.Active == active.Value)
            // Stable, deterministic ordering by choreId regardless of the backing
            // store's natural iteration order.
            .OrderBy(chore => chore.RowKey, StringComparer.Ordinal)
            .Select(Map)
            .ToList();
    }

    /// <inheritdoc />
    public async Task<ChoreResponse?> GetAsync(
        string householdId,
        string choreId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(choreId);

        var chore = await _chores.GetAsync(householdId, choreId, cancellationToken).ConfigureAwait(false);
        return chore is null ? null : Map(chore);
    }

    /// <inheritdoc />
    public async Task<ChoreResponse?> UpdateAsync(
        string householdId,
        string choreId,
        string title,
        string roomId,
        string cadence,
        int effort,
        int? minAge,
        bool active,
        string? ifMatch,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(choreId);
        ArgumentException.ThrowIfNullOrWhiteSpace(title);

        var normalizedCadence = NormalizeCadence(cadence);
        ValidateEffort(effort);

        // Existence pre-check so an unknown chore is a 404, not a 412/428 from the
        // concurrency layer.
        var existing = await _chores.GetAsync(householdId, choreId, cancellationToken).ConfigureAwait(false);
        if (existing is null)
        {
            return null;
        }

        // Validate the room reference before any write so a bad request leaves the
        // stored row unchanged.
        await EnsureRoomExistsAsync(householdId, roomId, cancellationToken).ConfigureAwait(false);

        existing.Title = title;
        existing.RoomId = roomId;
        existing.Cadence = normalizedCadence;
        existing.Effort = effort;
        existing.MinAge = minAge;
        existing.Active = active;
        await _chores.UpdateAsync(householdId, existing, ifMatch, cancellationToken).ConfigureAwait(false);

        // Re-read so the returned ETag is the persisted post-update version.
        var updated = await _chores.GetAsync(householdId, choreId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException(
                $"Chore '{choreId}' was updated but could not be read back.");

        return Map(updated);
    }

    /// <inheritdoc />
    public async Task<ChoreResponse?> DeactivateAsync(
        string householdId,
        string choreId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);
        ArgumentException.ThrowIfNullOrWhiteSpace(choreId);

        var existing = await _chores.GetAsync(householdId, choreId, cancellationToken).ConfigureAwait(false);
        if (existing is null)
        {
            return null;
        }

        existing.Active = false;

        // Deactivation is a distinct idempotent action, not a client-driven edit,
        // so it is not If-Match gated (Contract 7.3 scopes If-Match to updates);
        // the wildcard replaces the current version unconditionally.
        await _chores
            .UpdateAsync(householdId, existing, OptimisticConcurrency.Wildcard, cancellationToken)
            .ConfigureAwait(false);

        // Re-read so the returned ETag is the persisted post-deactivation version.
        var deactivated = await _chores.GetAsync(householdId, choreId, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException(
                $"Chore '{choreId}' was deactivated but could not be read back.");

        return Map(deactivated);
    }

    // A chore must attach to a room that exists in the same household; a dangling
    // reference is a client error (400) that persists no row.
    private async Task EnsureRoomExistsAsync(string householdId, string roomId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(roomId))
        {
            throw new ValidationException("A chore must reference a room (RoomId is required).");
        }

        var room = await _rooms.GetAsync(householdId, roomId, cancellationToken).ConfigureAwait(false);
        if (room is null)
        {
            throw new ValidationException(
                $"No room with id '{roomId}' exists in household '{householdId}'.");
        }
    }

    // Effort weights the assignment engine; a non-positive value is meaningless.
    private static void ValidateEffort(int effort)
    {
        if (effort <= 0)
        {
            throw new ValidationException("Effort must be a positive integer.");
        }
    }

    // Cadence is a small closed set (Contract 7.3); anything else is a client error.
    private static string NormalizeCadence(string cadence)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(cadence);

        if (string.Equals(cadence, DailyCadence, StringComparison.OrdinalIgnoreCase))
        {
            return DailyCadence;
        }

        if (string.Equals(cadence, WeeklyCadence, StringComparison.OrdinalIgnoreCase))
        {
            return WeeklyCadence;
        }

        throw new ValidationException($"Cadence must be '{DailyCadence}' or '{WeeklyCadence}'.");
    }

    private static ChoreResponse Map(ChoreEntity entity) => new(
        entity.RowKey,
        entity.Title,
        entity.RoomId,
        entity.Cadence,
        entity.Effort,
        entity.MinAge,
        entity.Active,
        entity.ETag.ToString());

    // Server-generated, opaque, collision-resistant id (Contract 7.3 keys).
    private static string NewId() => Guid.NewGuid().ToString("N");
}
