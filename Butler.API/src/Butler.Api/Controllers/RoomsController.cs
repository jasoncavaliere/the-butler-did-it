using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Rooms;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for the Rooms feature: the household's physical map chores
/// attach to (H4). Reads are open to the hub device and participants; mutations
/// are organizer-gated (Engineering Contract 7.4). Every route is scoped to a
/// household, and updates carry the <c>If-Match</c> optimistic-concurrency
/// precondition (7.3). Work is handed to MediatR.
/// </summary>
[ApiController]
[Route("households/{householdId}/rooms")]
[Tags("Rooms")]
public sealed class RoomsController : ControllerBase
{
    private readonly ISender _sender;

    public RoomsController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>Creates a room in the household (organizer only).</summary>
    [HttpPost]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(typeof(RoomResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<RoomResponse>> Create(
        string householdId,
        [FromBody] CreateRoomRequest request,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(
            new CreateRoomCommand(householdId, request.Name, request.SortOrder),
            cancellationToken);

        return CreatedAtAction(
            nameof(Get),
            new { householdId, roomId = result.RoomId },
            result);
    }

    /// <summary>Lists the household's rooms ordered by sort order (open read).</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<RoomResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<RoomResponse>>> List(
        string householdId,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new ListRoomsQuery(householdId), cancellationToken);
        return Ok(result);
    }

    /// <summary>Reads one room by id, or <c>404</c> problem details when unknown (open read).</summary>
    [HttpGet("{roomId}")]
    [ProducesResponseType(typeof(RoomResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<RoomResponse>> Get(
        string householdId,
        string roomId,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new GetRoomQuery(householdId, roomId), cancellationToken);
        return result is null ? RoomNotFound(householdId, roomId) : Ok(result);
    }

    /// <summary>Updates a room under <c>If-Match</c> optimistic concurrency (organizer only).</summary>
    [HttpPut("{roomId}")]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(typeof(RoomResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status412PreconditionFailed)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status428PreconditionRequired)]
    public async Task<ActionResult<RoomResponse>> Update(
        string householdId,
        string roomId,
        [FromBody] UpdateRoomRequest request,
        CancellationToken cancellationToken)
    {
        // The If-Match header is the optimistic-concurrency precondition (7.3);
        // its absence surfaces as 428 from the persistence seam.
        var ifMatch = Request.Headers.IfMatch.ToString();

        var result = await _sender.Send(
            new UpdateRoomCommand(householdId, roomId, request.Name, request.SortOrder, ifMatch),
            cancellationToken);

        return result is null ? RoomNotFound(householdId, roomId) : Ok(result);
    }

    /// <summary>Deletes a room, or <c>404</c> problem details when unknown (organizer only).</summary>
    [HttpDelete("{roomId}")]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(
        string householdId,
        string roomId,
        CancellationToken cancellationToken)
    {
        var deleted = await _sender.Send(new DeleteRoomCommand(householdId, roomId), cancellationToken);
        return deleted ? NoContent() : RoomNotFound(householdId, roomId);
    }

    // RFC 7807 problem details for an unknown room (Engineering Contract 7.5).
    private ObjectResult RoomNotFound(string householdId, string roomId) => Problem(
        statusCode: StatusCodes.Status404NotFound,
        title: "Room not found.",
        detail: $"No room with id '{roomId}' exists in household '{householdId}'.",
        type: $"https://httpstatuses.io/{StatusCodes.Status404NotFound}");
}

/// <summary>Request body for <c>POST /households/{householdId}/rooms</c>.</summary>
/// <param name="Name">The room's display name (required).</param>
/// <param name="SortOrder">The room's position in the hub-board ordering.</param>
public sealed record CreateRoomRequest(
    [Required(AllowEmptyStrings = false)] string Name,
    int SortOrder);

/// <summary>Request body for <c>PUT /households/{householdId}/rooms/{roomId}</c>.</summary>
/// <param name="Name">The room's display name (required).</param>
/// <param name="SortOrder">The room's position in the hub-board ordering.</param>
public sealed record UpdateRoomRequest(
    [Required(AllowEmptyStrings = false)] string Name,
    int SortOrder);
