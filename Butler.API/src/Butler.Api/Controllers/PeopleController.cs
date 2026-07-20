using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Auth;
using Butler.Api.Application.People;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for the People feature: the household's organizer-managed
/// roster (participants and children). Reads are open to the hub device and
/// participants so tap-to-claim (Epic 30) can render names; mutations are
/// organizer-gated (Engineering Contract 7.4). Every route is scoped to a
/// household, updates carry the <c>If-Match</c> optimistic-concurrency
/// precondition (7.3), and the last-organizer guard is enforced by the service.
/// Work is handed to MediatR.
/// </summary>
[ApiController]
[Route("households/{householdId}/people")]
[Tags("People")]
public sealed class PeopleController : ControllerBase
{
    private readonly ISender _sender;

    public PeopleController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>Creates a person in the household (organizer only).</summary>
    [HttpPost]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(typeof(PersonResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<PersonResponse>> Create(
        string householdId,
        [FromBody] CreatePersonRequest request,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(
            new CreatePersonCommand(householdId, request.DisplayName, request.Role, request.IsChild, request.ClaimColor),
            cancellationToken);

        return CreatedAtAction(
            nameof(Get),
            new { householdId, personId = result.PersonId },
            result);
    }

    /// <summary>Lists the household's people (open read for the hub/participants).</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<PersonResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<PersonResponse>>> List(
        string householdId,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new ListPeopleQuery(householdId), cancellationToken);
        return Ok(result);
    }

    /// <summary>Reads one person by id, or <c>404</c> problem details when unknown (open read).</summary>
    [HttpGet("{personId}")]
    [ProducesResponseType(typeof(PersonResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PersonResponse>> Get(
        string householdId,
        string personId,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new GetPersonQuery(householdId, personId), cancellationToken);
        return result is null ? PersonNotFound(householdId, personId) : Ok(result);
    }

    /// <summary>Updates a person under <c>If-Match</c> optimistic concurrency (organizer only).</summary>
    [HttpPut("{personId}")]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(typeof(PersonResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status412PreconditionFailed)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status428PreconditionRequired)]
    public async Task<ActionResult<PersonResponse>> Update(
        string householdId,
        string personId,
        [FromBody] UpdatePersonRequest request,
        CancellationToken cancellationToken)
    {
        // The If-Match header is the optimistic-concurrency precondition (7.3);
        // its absence surfaces as 428 from the persistence seam.
        var ifMatch = Request.Headers.IfMatch.ToString();

        var result = await _sender.Send(
            new UpdatePersonCommand(
                householdId, personId, request.DisplayName, request.Role, request.IsChild, request.ClaimColor, ifMatch),
            cancellationToken);

        return result is null ? PersonNotFound(householdId, personId) : Ok(result);
    }

    /// <summary>Deletes a person, or <c>404</c> problem details when unknown (organizer only).</summary>
    [HttpDelete("{personId}")]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(
        string householdId,
        string personId,
        CancellationToken cancellationToken)
    {
        var deleted = await _sender.Send(new DeletePersonCommand(householdId, personId), cancellationToken);
        return deleted ? NoContent() : PersonNotFound(householdId, personId);
    }

    // RFC 7807 problem details for an unknown person (Engineering Contract 7.5).
    private ObjectResult PersonNotFound(string householdId, string personId) => Problem(
        statusCode: StatusCodes.Status404NotFound,
        title: "Person not found.",
        detail: $"No person with id '{personId}' exists in household '{householdId}'.",
        type: $"https://httpstatuses.io/{StatusCodes.Status404NotFound}");
}

/// <summary>Request body for <c>POST /households/{householdId}/people</c>.</summary>
/// <param name="DisplayName">The person's display name (required).</param>
/// <param name="Role">The person's role: <c>Organizer</c> or <c>Participant</c> (required).</param>
/// <param name="IsChild">Whether the person is a child.</param>
/// <param name="ClaimColor">The colour a claimed tile glows in; optional.</param>
public sealed record CreatePersonRequest(
    [Required(AllowEmptyStrings = false)] string DisplayName,
    [Required(AllowEmptyStrings = false)] string Role,
    bool IsChild,
    string? ClaimColor);

/// <summary>Request body for <c>PUT /households/{householdId}/people/{personId}</c>.</summary>
/// <param name="DisplayName">The person's display name (required).</param>
/// <param name="Role">The person's role: <c>Organizer</c> or <c>Participant</c> (required).</param>
/// <param name="IsChild">Whether the person is a child.</param>
/// <param name="ClaimColor">The colour a claimed tile glows in; optional.</param>
public sealed record UpdatePersonRequest(
    [Required(AllowEmptyStrings = false)] string DisplayName,
    [Required(AllowEmptyStrings = false)] string Role,
    bool IsChild,
    string? ClaimColor);
