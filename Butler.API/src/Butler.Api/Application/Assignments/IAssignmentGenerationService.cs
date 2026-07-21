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
}
