using MediatR;

namespace Butler.Api.Application.Assignments;

/// <summary>
/// Reverses a completion from a tap (the inverse of <see cref="CompleteChoreCommand"/>).
/// The result is <c>null</c> when no assignment matches
/// <c>(householdId, weekIso, choreId)</c>, which the controller maps to a <c>404</c>.
/// Undoing an assignment that is already <c>Open</c> (or was never completed) succeeds
/// as a no-op (idempotent) that does not double-subtract effort.
/// </summary>
/// <param name="HouseholdId">The household the assignment belongs to.</param>
/// <param name="WeekIso">The assignment's ISO year-week (for example <c>2026-W29</c>).</param>
/// <param name="ChoreId">The chore whose completion is being reversed.</param>
/// <param name="PersonId">The acting person the reversal is attributed to.</param>
public sealed record UndoChoreCommand(
    string HouseholdId,
    string WeekIso,
    string ChoreId,
    string PersonId) : IRequest<UndoChoreResponse?>;

/// <summary>Handles <see cref="UndoChoreCommand"/> via the application service.</summary>
public sealed class UndoChoreCommandHandler
    : IRequestHandler<UndoChoreCommand, UndoChoreResponse?>
{
    private readonly IChoreCompletionService _completions;

    public UndoChoreCommandHandler(IChoreCompletionService completions)
    {
        ArgumentNullException.ThrowIfNull(completions);
        _completions = completions;
    }

    public Task<UndoChoreResponse?> Handle(
        UndoChoreCommand request,
        CancellationToken cancellationToken) =>
        _completions.UndoAsync(
            request.HouseholdId,
            request.WeekIso,
            request.ChoreId,
            request.PersonId,
            cancellationToken);
}

/// <summary>
/// The state of an assignment after a successful tap-to-undo: the week it belongs
/// to, the chore, who it is assigned to, and its lifecycle status (always
/// <c>Open</c> on success - the reversal returned it to the open state).
/// </summary>
/// <param name="WeekIso">The ISO-8601 year-week the assignment belongs to.</param>
/// <param name="ChoreId">The chore whose completion was reversed.</param>
/// <param name="AssignedPersonId">The person the chore is assigned to for the week.</param>
/// <param name="Status">The assignment's lifecycle state (<c>Open</c>).</param>
public sealed record UndoChoreResponse(
    string WeekIso,
    string ChoreId,
    string AssignedPersonId,
    string Status);
