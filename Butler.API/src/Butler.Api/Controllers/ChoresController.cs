using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Chores;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for the Chores feature: the household's recurring tasks, each
/// attached to a room (H2) and carrying the effort/cadence/min-age the Epic 40
/// assignment engine reads. Reads are open to the hub device and participants;
/// mutations are organizer-gated (Engineering Contract 7.4). Every route is
/// scoped to a household, updates carry the <c>If-Match</c> optimistic-concurrency
/// precondition (7.3), and chores are deactivated rather than deleted. Work is
/// handed to MediatR.
/// </summary>
[ApiController]
[Route("households/{householdId}/chores")]
[Tags("Chores")]
public sealed class ChoresController : ControllerBase
{
    private readonly ISender _sender;

    public ChoresController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>Creates a chore in the household (organizer only).</summary>
    [HttpPost]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(typeof(ChoreResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<ChoreResponse>> Create(
        string householdId,
        [FromBody] CreateChoreRequest request,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(
            new CreateChoreCommand(
                householdId, request.Title, request.RoomId, request.Cadence, request.Effort, request.MinAge),
            cancellationToken);

        return CreatedAtAction(
            nameof(Get),
            new { householdId, choreId = result.ChoreId },
            result);
    }

    /// <summary>Lists the household's chores, optionally filtered by active state (open read).</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<ChoreResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<ChoreResponse>>> List(
        string householdId,
        [FromQuery] bool? active,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new ListChoresQuery(householdId, active), cancellationToken);
        return Ok(result);
    }

    /// <summary>Reads one chore by id, or <c>404</c> problem details when unknown (open read).</summary>
    [HttpGet("{choreId}")]
    [ProducesResponseType(typeof(ChoreResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ChoreResponse>> Get(
        string householdId,
        string choreId,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new GetChoreQuery(householdId, choreId), cancellationToken);
        return result is null ? ChoreNotFound(householdId, choreId) : Ok(result);
    }

    /// <summary>Updates a chore under <c>If-Match</c> optimistic concurrency (organizer only).</summary>
    [HttpPut("{choreId}")]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(typeof(ChoreResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status412PreconditionFailed)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status428PreconditionRequired)]
    public async Task<ActionResult<ChoreResponse>> Update(
        string householdId,
        string choreId,
        [FromBody] UpdateChoreRequest request,
        CancellationToken cancellationToken)
    {
        // The If-Match header is the optimistic-concurrency precondition (7.3);
        // its absence surfaces as 428 from the persistence seam.
        var ifMatch = Request.Headers.IfMatch.ToString();

        var result = await _sender.Send(
            new UpdateChoreCommand(
                householdId,
                choreId,
                request.Title,
                request.RoomId,
                request.Cadence,
                request.Effort,
                request.MinAge,
                request.Active,
                ifMatch),
            cancellationToken);

        return result is null ? ChoreNotFound(householdId, choreId) : Ok(result);
    }

    /// <summary>Deactivates a chore (retains the row), or <c>404</c> when unknown (organizer only).</summary>
    [HttpPost("{choreId}/deactivate")]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(typeof(ChoreResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ChoreResponse>> Deactivate(
        string householdId,
        string choreId,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new DeactivateChoreCommand(householdId, choreId), cancellationToken);
        return result is null ? ChoreNotFound(householdId, choreId) : Ok(result);
    }

    // RFC 7807 problem details for an unknown chore (Engineering Contract 7.5).
    private ObjectResult ChoreNotFound(string householdId, string choreId) => Problem(
        statusCode: StatusCodes.Status404NotFound,
        title: "Chore not found.",
        detail: $"No chore with id '{choreId}' exists in household '{householdId}'.",
        type: $"https://httpstatuses.io/{StatusCodes.Status404NotFound}");
}

/// <summary>Request body for <c>POST /households/{householdId}/chores</c>.</summary>
/// <param name="Title">The chore's display title (required).</param>
/// <param name="RoomId">The id of the room the chore attaches to (required).</param>
/// <param name="Cadence">How often the chore recurs: <c>Daily</c> or <c>Weekly</c> (required).</param>
/// <param name="Effort">The relative effort weight (positive).</param>
/// <param name="MinAge">The minimum age to be assigned the chore; optional.</param>
public sealed record CreateChoreRequest(
    [Required(AllowEmptyStrings = false)] string Title,
    [Required(AllowEmptyStrings = false)] string RoomId,
    [Required(AllowEmptyStrings = false)] string Cadence,
    int Effort,
    int? MinAge);

/// <summary>Request body for <c>PUT /households/{householdId}/chores/{choreId}</c>.</summary>
/// <param name="Title">The chore's display title (required).</param>
/// <param name="RoomId">The id of the room the chore attaches to (required).</param>
/// <param name="Cadence">How often the chore recurs: <c>Daily</c> or <c>Weekly</c> (required).</param>
/// <param name="Effort">The relative effort weight (positive).</param>
/// <param name="MinAge">The minimum age to be assigned the chore; optional.</param>
/// <param name="Active">Whether the chore is active (set <c>true</c> to reactivate).</param>
public sealed record UpdateChoreRequest(
    [Required(AllowEmptyStrings = false)] string Title,
    [Required(AllowEmptyStrings = false)] string RoomId,
    [Required(AllowEmptyStrings = false)] string Cadence,
    int Effort,
    int? MinAge,
    bool Active);
