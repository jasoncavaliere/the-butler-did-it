using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Households;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for the Households feature (the root aggregate). It resolves
/// the calling organizer from the authenticated principal (Engineering Contract
/// 7.4) and hands the work to MediatR. The whole controller is organizer-gated:
/// the organizer is the only authenticated user in v1.
/// </summary>
[ApiController]
[Route("households")]
[Authorize(Policy = OrganizerAuthorization.PolicyName)]
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
            return Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Household not found.",
                detail: $"No household with id '{householdId}' exists.",
                type: $"https://httpstatuses.io/{StatusCodes.Status404NotFound}");
        }

        return Ok(result);
    }
}

/// <summary>Request body for <c>POST /households</c>.</summary>
/// <param name="Name">The household's display name (required).</param>
public sealed record CreateHouseholdRequest(
    [Required(AllowEmptyStrings = false)] string Name);
