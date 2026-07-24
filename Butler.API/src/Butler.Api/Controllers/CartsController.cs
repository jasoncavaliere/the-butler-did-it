using Butler.Api.Application.Carts;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for the weekly grocery cart (G2, journey 6.4). A household has
/// exactly one cart per ISO week, so both routes are week-addressed: one hands
/// back the current week's <c>Building</c> cart (creating it on first use), the
/// other reads any week's cart as it stands. Both return the cart together with
/// its items in one response shape. Reads are open to the hub and participants -
/// the sensitive action is the confirm, which arrives with G4. Work is handed to
/// MediatR.
/// </summary>
[ApiController]
[Route("households/{householdId}/carts")]
[Tags("Carts")]
public sealed class CartsController : ControllerBase
{
    private readonly ISender _sender;

    public CartsController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>
    /// Returns the household's current <c>Building</c> cart with its items,
    /// creating the week's cart when it does not exist yet (get-or-create). The
    /// week is computed server-side from the injected clock unless the optional
    /// <paramref name="weekIso"/> supplies it. Calling it twice returns the same
    /// cart - it never mints a second cart for the week. An unknown household is a
    /// <c>404</c>; a week whose cart is already <c>Confirmed</c> is a <c>409</c>
    /// (a confirmed cart is never returned as the building cart - read it through
    /// <see cref="Get"/> instead).
    /// </summary>
    [HttpGet("current")]
    [ProducesResponseType(typeof(CartResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public async Task<ActionResult<CartResponse>> GetCurrent(
        string householdId,
        [FromQuery] string? weekIso,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new GetCurrentCartQuery(householdId, weekIso), cancellationToken);
        return result is null ? HouseholdNotFound(householdId) : Ok(result);
    }

    /// <summary>
    /// Reads one week's cart with its items, exactly as it stands (this route
    /// creates nothing). An unknown household and a week with no cart are both
    /// <c>404</c> problem details, with distinct titles.
    /// </summary>
    [HttpGet("{weekIso}")]
    [ProducesResponseType(typeof(CartResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<CartResponse>> Get(
        string householdId,
        string weekIso,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new GetCartQuery(householdId, weekIso), cancellationToken);

        if (!result.HouseholdExists)
        {
            return HouseholdNotFound(householdId);
        }

        if (result.Cart is null)
        {
            return Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Cart not found.",
                detail: $"No cart for week '{weekIso}' exists in household '{householdId}'.",
                type: $"https://httpstatuses.io/{StatusCodes.Status404NotFound}");
        }

        return Ok(result.Cart);
    }

    // RFC 7807 problem details for an unknown household (Engineering Contract 7.5).
    private ObjectResult HouseholdNotFound(string householdId) => Problem(
        statusCode: StatusCodes.Status404NotFound,
        title: "Household not found.",
        detail: $"No household with id '{householdId}' exists.",
        type: $"https://httpstatuses.io/{StatusCodes.Status404NotFound}");
}
