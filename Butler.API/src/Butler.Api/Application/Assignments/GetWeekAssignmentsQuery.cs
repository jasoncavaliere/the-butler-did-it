using MediatR;

namespace Butler.Api.Application.Assignments;

/// <summary>
/// Reads one household week's assignments, generating them first when the week
/// is the current one and has none yet (the board's lazy read, #110). The result
/// is <c>null</c> when the household does not exist, which the controller maps to
/// a <c>404</c>.
/// </summary>
/// <param name="HouseholdId">The household whose week to read.</param>
/// <param name="WeekIso">The ISO year-week to read (for example <c>2026-W29</c>).</param>
public sealed record GetWeekAssignmentsQuery(string HouseholdId, string WeekIso)
    : IRequest<AssignmentSetResponse?>;

/// <summary>Handles <see cref="GetWeekAssignmentsQuery"/> via the application service.</summary>
public sealed class GetWeekAssignmentsQueryHandler
    : IRequestHandler<GetWeekAssignmentsQuery, AssignmentSetResponse?>
{
    private readonly IAssignmentGenerationService _assignments;

    public GetWeekAssignmentsQueryHandler(IAssignmentGenerationService assignments)
    {
        ArgumentNullException.ThrowIfNull(assignments);
        _assignments = assignments;
    }

    public Task<AssignmentSetResponse?> Handle(
        GetWeekAssignmentsQuery request,
        CancellationToken cancellationToken) =>
        _assignments.GetOrGenerateAsync(request.HouseholdId, request.WeekIso, cancellationToken);
}
