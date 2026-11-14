using Butler.Api.Application.Events;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for client-posted usage events (#122). Only <c>hub-glanced</c>
/// is accepted; every other type (including <c>participant-claimed</c>) is
/// recorded server-side and is an RFC 7807 <c>400</c> here. Work is handed to
/// MediatR.
/// </summary>
[ApiController]
[Route("households/{householdId}/events")]
[Tags("Events")]
public sealed class EventsController : ControllerBase
{
    private readonly ISender _sender;

    public EventsController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>Records a client usage event (only <c>hub-glanced</c> is allowed).</summary>
    [HttpPost]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Record(
        string householdId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] RecordEventRequest? request,
        CancellationToken cancellationToken)
    {
        var recorded = await _sender.Send(
            new RecordClientEventCommand(householdId, request?.Type),
            cancellationToken);
        return recorded ? NoContent() : HouseholdNotFound(householdId);
    }

    // RFC 7807 problem details for an unknown household (Engineering Contract 7.5).
    private ObjectResult HouseholdNotFound(string householdId) => Problem(
        statusCode: StatusCodes.Status404NotFound,
        title: "Household not found.",
        detail: $"No household with id '{householdId}' exists.",
        type: $"https://httpstatuses.io/{StatusCodes.Status404NotFound}");
}

/// <summary>Request body for <c>POST /households/{householdId}/events</c>.</summary>
/// <param name="Type">The event type; only <c>hub-glanced</c> is accepted.</param>
public sealed record RecordEventRequest(string? Type);
