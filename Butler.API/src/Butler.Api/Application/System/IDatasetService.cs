namespace Butler.Api.Application.System;

/// <summary>
/// Owns the deployment's dataset id (#100 D7): an opaque id that changes
/// whenever the data behind the API is replaced, so the hub can tell that its
/// offline cache and queued writes belong to a dataset that no longer exists.
/// </summary>
public interface IDatasetService
{
    /// <summary>
    /// Returns the stored dataset id. When none is stored (first boot, or the
    /// storage was wiped) a new id is minted, persisted, and returned.
    /// </summary>
    Task<string> GetOrCreateAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces the stored dataset id with a new one and returns it. The demo
    /// seeder calls this on every (re)seed.
    /// </summary>
    Task<string> RegenerateAsync(CancellationToken cancellationToken = default);
}
