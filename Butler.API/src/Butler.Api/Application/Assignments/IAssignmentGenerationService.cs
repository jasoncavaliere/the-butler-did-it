namespace Butler.Api.Application.Assignments;

/// <summary>
/// The one place that composes fetch -> compute -> persist for a household week's
/// chore assignments (C3, journey 6.3). It reads the household's <c>Active</c>
/// chores (H3) and people (H4), computes each person's trailing-4-week completed
/// load from the <c>ChoreCompletions</c> ledger, resolves the target
/// <c>weekIso</c> from the injected clock when the caller supplies none, runs the
/// pure C2 <see cref="IFairAssignmentEngine"/>, and persists the result through
/// the C1 repositories. The engine itself does no I/O; this service owns all of
/// it (Engineering Contract 7.6).
/// </summary>
public interface IAssignmentGenerationService
{
    /// <summary>
    /// Generates - or idempotently regenerates - the assignments for one household
    /// week.
    /// </summary>
    /// <remarks>
    /// <para>
    /// When <paramref name="weekIso"/> is <c>null</c> or blank the week is computed
    /// server-side from the injected clock; a supplied value is validated and used
    /// as-is (a malformed value is a client error).
    /// </para>
    /// <para>
    /// <b>Regenerate rule (idempotent).</b> Regenerating a week that already has
    /// assignments replaces only its <c>Open</c> rows; <c>Done</c> rows and their
    /// <c>ChoreCompletions</c> are left untouched and their chores are never
    /// re-assigned, and the effort of those completed chores is reflected in the
    /// recomputed trailing loads.
    /// </para>
    /// </remarks>
    /// <param name="householdId">The household whose week to generate.</param>
    /// <param name="weekIso">The target ISO year-week, or <c>null</c>/blank to use the clock's current week.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>
    /// The resulting assignment set for the week, or <c>null</c> when no household
    /// with <paramref name="householdId"/> exists (the controller maps that to a
    /// <c>404</c>).
    /// </returns>
    Task<AssignmentSetResponse?> GenerateAsync(
        string householdId,
        string? weekIso,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Reads one household week's assignments, generating them first when the
    /// week is the current one and has none yet (the board's lazy read, #110).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Lazy rule.</b> Only the current week per the injected clock is ever
    /// generated, and only while it has no stored rows. A week that already has
    /// rows, and any past or future week, is returned as stored with no writes.
    /// Generation runs the same C2/C3 path as <see cref="GenerateAsync"/> under a
    /// per-household lock that <see cref="GenerateAsync"/> also takes, and the
    /// week is re-read inside the lock, so concurrent first reads persist one set.
    /// </para>
    /// <para>
    /// <b>Stored projection.</b> <c>Done</c> rows are always returned; <c>Open</c>
    /// rows only for chores that are still active. Unplaced chores are never
    /// persisted, so a stored week has an empty unassigned list. A household with
    /// no active chores or no eligible members reads as an empty week and nothing
    /// is persisted.
    /// </para>
    /// </remarks>
    /// <param name="householdId">The household whose week to read.</param>
    /// <param name="weekIso">The ISO year-week to read; a malformed value is a client error (<c>400</c>).</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>
    /// The week's assignment set (carrying the server's current week), or
    /// <c>null</c> when no household with <paramref name="householdId"/> exists
    /// (the controller maps that to a <c>404</c>).
    /// </returns>
    Task<AssignmentSetResponse?> GetOrGenerateAsync(
        string householdId,
        string weekIso,
        CancellationToken cancellationToken = default);
}
