using Butler.Api.Application.Fairness;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for the fairness view (C6, journey 6.3): the household's
/// contribution balance over a trailing ISO-week window - the Section 10 fairness
/// guardrail. Its one route is a read, open to the hub device and participants
/// like the other glanceable reads (Engineering Contract 7.4); it is scoped to a
/// household and issues no cross-household query (7.3). Work is handed to MediatR.
/// </summary>
[ApiController]
[Route("households/{householdId}/fairness")]
[Tags("Fairness")]
public sealed class FairnessController : ControllerBase
{
    private readonly ISender _sender;

    public FairnessController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>
    /// Reads the household's contribution balance over the trailing
    /// <paramref name="windowWeeks"/> ISO weeks (default 4). Returns each person's
    /// completed effort and share of the household total. An unknown household is a
    /// <c>404</c>; a non-positive window is a <c>400</c>.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(FairnessResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<FairnessResponse>> Get(
        string householdId,
        [FromQuery] int windowWeeks = FairnessService.DefaultWindowWeeks,
        CancellationToken cancellationToken = default)
    {
        var result = await _sender.Send(
            new GetFairnessQuery(householdId, windowWeeks),
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
