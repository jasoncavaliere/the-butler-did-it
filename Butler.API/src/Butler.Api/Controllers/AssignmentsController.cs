using System.Security.Claims;
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

    /// <summary>
    /// Completes an assignment from a tap (C4, journey 6.2). It appends a
    /// <c>ChoreCompletion</c> and flips the assignment to <c>Done</c> under
    /// optimistic concurrency. Completion is not a sensitive action (Decision D-3),
    /// so any authenticated caller - a tap-to-claim participant (T1) or a paired hub
    /// device (T5) - may drive it; no organizer authority is required. A second
    /// complete of an already-<c>Done</c> assignment is an idempotent success. An
    /// unknown assignment is a <c>404</c>.
    /// </summary>
    /// <remarks>
    /// The actor the completion is attributed to is the participant session's own
    /// <c>personId</c> when the caller holds one; otherwise (a shared hub tablet or
    /// an organizer) it is the <c>personId</c> the caller supplies in the body - the
    /// UI's active participant (T3). A completion with no resolvable actor is a
    /// <c>400</c>.
    /// </remarks>
    [HttpPost("{weekIso}/{choreId}/complete")]
    [Authorize]
    [ProducesResponseType(typeof(CompleteChoreResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<CompleteChoreResponse>> Complete(
        string householdId,
        string weekIso,
        string choreId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] CompleteChoreRequest? request,
        CancellationToken cancellationToken)
    {
        var personId = ResolveActorPersonId(request);
        if (string.IsNullOrWhiteSpace(personId))
        {
            return Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "A person is required to complete a chore.",
                detail: "Supply the acting personId in the request body, or present a participant session.",
                type: $"https://httpstatuses.io/{StatusCodes.Status400BadRequest}");
        }

        var result = await _sender.Send(
            new CompleteChoreCommand(householdId, weekIso, choreId, personId),
            cancellationToken);

        if (result is null)
        {
            return Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Assignment not found.",
                detail: $"No assignment for chore '{choreId}' in week '{weekIso}' exists in household '{householdId}'.",
                type: $"https://httpstatuses.io/{StatusCodes.Status404NotFound}");
        }

        return Ok(result);
    }

    // The completion's actor: a participant session identifies itself, so its own
    // personId (the NameIdentifier claim) is authoritative. A hub device or an
    // organizer is not a person, so the actor arrives in the body - the active
    // participant the UI selected on the shared tablet (T3).
    private string? ResolveActorPersonId(CompleteChoreRequest? request)
    {
        if (User.IsInRole(OrganizerAuthorization.ParticipantRole))
        {
            return User.FindFirstValue(ClaimTypes.NameIdentifier);
        }

        return request?.PersonId;
    }
}

/// <summary>
/// Request body for
/// <c>POST /households/{householdId}/assignments/{weekIso}/{choreId}/complete</c>.
/// Optional in its entirety - a participant session carries its own actor, so it
/// may complete with an empty body.
/// </summary>
/// <param name="PersonId">
/// The acting person's id (the UI's active participant), used when the caller is a
/// hub device or organizer rather than a participant session. Ignored when a
/// participant session is present.
/// </param>
public sealed record CompleteChoreRequest(string? PersonId);

/// <summary>
/// Request body for <c>POST /households/{householdId}/assignments/generate</c>.
/// Optional in its entirety - an empty POST generates the current week.
/// </summary>
/// <param name="WeekIso">
/// The target ISO year-week (for example <c>2026-W29</c>), or <c>null</c> to use
/// the current week from the injected clock.
/// </param>
public sealed record GenerateAssignmentsRequest(string? WeekIso);
