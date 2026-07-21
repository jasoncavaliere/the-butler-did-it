using Butler.Api.Application.Assignments;
using Butler.Api.Application.Auth;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for weekly chore assignments (C3, journey 6.3). Its one route
/// generates - or idempotently regenerates - a household week's assignments by
/// running the pure C2 engine over the household's active chores and people and
/// persisting the result (Engineering Contract 7.6). It may be triggered by an
/// organizer or by a paired hub device, but never a plain participant session
/// (7.4). Work is handed to MediatR.
/// </summary>
[ApiController]
[Route("households/{householdId}/assignments")]
[Tags("Assignments")]
public sealed class AssignmentsController : ControllerBase
{
    private readonly ISender _sender;

    public AssignmentsController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>
    /// Generates or regenerates the household's assignments for a week (organizer
    /// or paired hub device). The optional body carries a <c>weekIso</c>; when it
    /// is omitted (or the body is empty) the week is computed server-side from the
    /// injected clock. An unknown household is a <c>404</c>.
    /// </summary>
    [HttpPost("generate")]
    [Authorize(Policy = OrganizerAuthorization.OrganizerOrHubDevicePolicyName)]
    [ProducesResponseType(typeof(AssignmentSetResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<AssignmentSetResponse>> Generate(
        string householdId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] GenerateAssignmentsRequest? request,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(
            new GenerateAssignmentsCommand(householdId, request?.WeekIso),
            cancellationToken);

        if (result is null)
        {
            return Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Household not found.",
                detail: $"No household with id '{householdId}' exists.",
                type: $"https://httpstatuses.io/{StatusCodes.Status404NotFound}");
        }

        return Ok(result);
    }
}

/// <summary>
/// Request body for <c>POST /households/{householdId}/assignments/generate</c>.
/// Optional in its entirety - an empty POST generates the current week.
/// </summary>
/// <param name="WeekIso">
/// The target ISO year-week (for example <c>2026-W29</c>), or <c>null</c> to use
/// the current week from the injected clock.
/// </param>
public sealed record GenerateAssignmentsRequest(string? WeekIso);
