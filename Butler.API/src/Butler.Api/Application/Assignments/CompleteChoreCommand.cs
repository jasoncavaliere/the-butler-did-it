using Butler.Api.Application.Events;
using MediatR;

namespace Butler.Api.Application.Assignments;

/// <summary>
/// Completes one assignment from a tap (C4). The result is <c>null</c> when no
/// assignment matches <c>(householdId, weekIso, choreId)</c>, which the controller
/// maps to a <c>404</c>. Completing an assignment already <c>Done</c> succeeds as a
/// no-op (idempotent).
/// </summary>
/// <param name="HouseholdId">The household the assignment belongs to.</param>
/// <param name="WeekIso">The assignment's ISO year-week (for example <c>2026-W29</c>).</param>
/// <param name="ChoreId">The completed chore.</param>
/// <param name="PersonId">The actor the completion is attributed to.</param>
public sealed record CompleteChoreCommand(
    string HouseholdId,
    string WeekIso,
    string ChoreId,
    string PersonId) : IRequest<CompleteChoreResponse?>;

/// <summary>
/// Handles <see cref="CompleteChoreCommand"/> via the application service, then
/// records a <c>chore-completed</c> usage event (#122). The event is
/// recorded here rather than in the service because the demo seeder calls the
/// service directly and must not write fake usage.
/// </summary>
public sealed class CompleteChoreCommandHandler
    : IRequestHandler<CompleteChoreCommand, CompleteChoreResponse?>
{
    private readonly IChoreCompletionService _completions;
    private readonly IEventRecorder _events;

    public CompleteChoreCommandHandler(IChoreCompletionService completions, IEventRecorder events)
    {
        ArgumentNullException.ThrowIfNull(completions);
        ArgumentNullException.ThrowIfNull(events);
        _completions = completions;
        _events = events;
    }

    public async Task<CompleteChoreResponse?> Handle(
        CompleteChoreCommand request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var result = await _completions.CompleteAsync(
                request.HouseholdId,
                request.WeekIso,
                request.ChoreId,
                request.PersonId,
                cancellationToken)
            .ConfigureAwait(false);
        if (result is not null)
        {
            await _events.TryRecordAsync(
                    request.HouseholdId,
                    EventTypes.ChoreCompleted,
                    personId: request.PersonId,
                    choreId: request.ChoreId,
                    weekIso: result.WeekIso,
                    cancellationToken: cancellationToken)
                .ConfigureAwait(false);
        }

        return result;
    }
}

/// <summary>
/// The state of an assignment after a successful tap-to-complete (C4): the week it
/// belongs to, the chore, who it is assigned to, and its lifecycle status (always
/// <c>Done</c> on success).
/// </summary>
/// <param name="WeekIso">The ISO-8601 year-week the assignment belongs to.</param>
/// <param name="ChoreId">The completed chore.</param>
/// <param name="AssignedPersonId">The person the chore is assigned to for the week.</param>
/// <param name="Status">The assignment's lifecycle state (<c>Done</c>).</param>
public sealed record CompleteChoreResponse(
    string WeekIso,
    string ChoreId,
    string AssignedPersonId,
    string Status);
