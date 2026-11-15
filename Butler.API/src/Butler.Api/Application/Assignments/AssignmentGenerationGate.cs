using System.Collections.Concurrent;

namespace Butler.Api.Application.Assignments;

/// <summary>
/// Per-household in-process lock around a week's read-compute-persist (#110).
/// The lazy GET and POST generate both enter it, so two first reads of an empty
/// current week cannot both generate, and a regenerate never interleaves with a
/// lazy generate for the same household. Different households never block each
/// other. Register it as a singleton so the lock is shared across requests; it
/// guards one process only (the demo runs one API instance).
/// </summary>
public sealed class AssignmentGenerationGate : IDisposable
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _gates = new(StringComparer.Ordinal);

    /// <summary>
    /// Waits for the household's lock and returns it. The caller must
    /// <see cref="SemaphoreSlim.Release()"/> the returned semaphore in a
    /// <c>finally</c>. The lock is not re-entrant: never enter it twice in one
    /// call chain.
    /// </summary>
    /// <param name="householdId">The household whose lock to take.</param>
    /// <param name="cancellationToken">Cancels the wait.</param>
    /// <returns>The held semaphore, to release when done.</returns>
    public async Task<SemaphoreSlim> EnterAsync(string householdId, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        var gate = _gates.GetOrAdd(householdId, static _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        return gate;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        foreach (var gate in _gates.Values)
        {
            gate.Dispose();
        }

        _gates.Clear();
    }
}
