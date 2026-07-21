using MediatR;

namespace Butler.Api.Application.Assignments;

/// <summary>
/// Generates - or idempotently regenerates - one household week's chore
/// assignments (C3). The result is <c>null</c> when the household does not exist,
/// which the controller maps to a <c>404</c>.
/// </summary>
/// <param name="HouseholdId">The household whose week to generate.</param>
/// <param name="WeekIso">
/// The target ISO year-week, or <c>null</c>/blank to use the injected clock's
/// current week.
/// </param>
public sealed record GenerateAssignmentsCommand(string HouseholdId, string? WeekIso)
    : IRequest<AssignmentSetResponse?>;

/// <summary>Handles <see cref="GenerateAssignmentsCommand"/> via the application service.</summary>
public sealed class GenerateAssignmentsCommandHandler
    : IRequestHandler<GenerateAssignmentsCommand, AssignmentSetResponse?>
{
    private readonly IAssignmentGenerationService _assignments;

    public GenerateAssignmentsCommandHandler(IAssignmentGenerationService assignments)
    {
        ArgumentNullException.ThrowIfNull(assignments);
        _assignments = assignments;
    }

    public Task<AssignmentSetResponse?> Handle(
        GenerateAssignmentsCommand request,
        CancellationToken cancellationToken) =>
        _assignments.GenerateAsync(request.HouseholdId, request.WeekIso, cancellationToken);
}
