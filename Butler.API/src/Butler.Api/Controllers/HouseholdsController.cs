using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Households;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for the Households feature (the root aggregate). It resolves
/// the calling organizer from the authenticated principal (Engineering Contract
/// 7.4) and hands the work to MediatR. Creating a household is organizer-only;
/// reading one is open to the organizer or a paired hub device (#105), so a hub
/// with no organizer signed in still shows its household. Tearing one down
/// (#124) is organizer-only and needs the exact household name as confirmation.
/// A participant session is forbidden on all three.
/// </summary>
[ApiController]
[Route("households")]
[Tags("Households")]
public sealed class HouseholdsController : ControllerBase
{
    private readonly ISender _sender;

    public HouseholdsController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>Creates a household and seeds the calling organizer's roster row.</summary>
    [HttpPost]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(typeof(HouseholdResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<HouseholdResponse>> Create(
        [FromBody] CreateHouseholdRequest request,
        CancellationToken cancellationToken)
    {
        // The caller's object id is the organizer binding stored on both the
        // Households row and the seeded People row (dev organizer in dev mode).
        var organizerObjectId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var organizerDisplayName = User.FindFirstValue(ClaimTypes.Name);

        var result = await _sender.Send(
            new CreateHouseholdCommand(request.Name, organizerObjectId, organizerDisplayName),
            cancellationToken);

        return CreatedAtAction(nameof(Get), new { householdId = result.HouseholdId }, result);
    }

    /// <summary>Reads a household by id, or <c>404</c> problem details when unknown.</summary>
    [HttpGet("{householdId}")]
    [Authorize(Policy = OrganizerAuthorization.OrganizerOrHubDevicePolicyName)]
    [ProducesResponseType(typeof(HouseholdResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<HouseholdResponse>> Get(
        string householdId,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new GetHouseholdQuery(householdId), cancellationToken);
        if (result is null)
        {
            return HouseholdNotFound(householdId);
        }

        return Ok(result);
    }

    /// <summary>
    /// Tears a household down: deletes every row it owns in every registered
    /// table, which also revokes its hub-device and participant tokens. The body's
    /// <c>confirmName</c> must exactly equal the stored name (ordinal,
    /// case-sensitive), or nothing is deleted.
    /// </summary>
    [HttpDelete("{householdId}")]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(
        string householdId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] DeleteHouseholdRequest? request,
        CancellationToken cancellationToken)
    {
        // A DELETE with no body at all (often sent with no Content-Type) would
        // otherwise be a 415; a missing confirmation is a 400 like a blank one.
        if (request is null)
        {
            ModelState.AddModelError(
                nameof(DeleteHouseholdRequest.ConfirmName),
                "The ConfirmName field is required.");
            return ValidationProblem(ModelState);
        }

        var result = await _sender.Send(
            new DeleteHouseholdCommand(householdId, request.ConfirmName),
            cancellationToken);

        return result switch
        {
            HouseholdTeardownResult.Deleted => NoContent(),
            HouseholdTeardownResult.NotFound => HouseholdNotFound(householdId),
            _ => Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Household name does not match.",
                detail: "confirmName must exactly equal the household's name; nothing was deleted.",
                type: $"https://httpstatuses.io/{StatusCodes.Status400BadRequest}"),
        };
    }

    private ObjectResult HouseholdNotFound(string householdId) =>
        Problem(
            statusCode: StatusCodes.Status404NotFound,
            title: "Household not found.",
            detail: $"No household with id '{householdId}' exists.",
            type: $"https://httpstatuses.io/{StatusCodes.Status404NotFound}");
}

/// <summary>Request body for <c>POST /households</c>.</summary>
/// <param name="Name">The household's display name (required).</param>
public sealed record CreateHouseholdRequest(
    [Required(AllowEmptyStrings = false)] string Name);

/// <summary>Request body for <c>DELETE /households/{householdId}</c>.</summary>
/// <param name="ConfirmName">
/// The household's name, typed to confirm the teardown (required, exact match).
/// </param>
public sealed record DeleteHouseholdRequest(
    [Required(AllowEmptyStrings = false)] string ConfirmName);
