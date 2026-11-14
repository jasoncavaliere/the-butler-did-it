using Butler.Api.Application.Auth;
using Butler.Api.Application.Insights;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for the organizer's insights view (#123): four series over a
/// trailing ISO-week window. It is organizer-only, so a participant session and
/// the paired hub device are <c>403</c> (Engineering Contract 7.4). It is scoped
/// to a household and issues no cross-household query (7.3). Work is handed to
/// MediatR.
/// </summary>
[ApiController]
[Route("households/{householdId}/insights")]
[Tags("Insights")]
public sealed class InsightsController : ControllerBase
{
    private readonly ISender _sender;

    public InsightsController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>
    /// Reads the household's insights over the trailing <paramref name="weeks"/>
    /// ISO weeks: the top contributor's share and completions per member per week,
    /// hub glances per day, and confirmed carts per month. A missing,
    /// non-numeric or out-of-range <paramref name="weeks"/> (1 to 52) is a
    /// <c>400</c>; an unknown household is a <c>404</c> (organizer only).
    /// </summary>
    [HttpGet]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(typeof(InsightsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<InsightsResponse>> Get(
        string householdId,
        [FromQuery] int? weeks,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(
            new GetInsightsQuery(householdId, weeks),
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
