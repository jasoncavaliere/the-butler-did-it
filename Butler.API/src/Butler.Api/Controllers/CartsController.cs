using System.Security.Claims;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Carts;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for the weekly grocery cart (G2/G4, journey 6.4). A household
/// has exactly one cart per ISO week, so every route is week-addressed: one hands
/// back the current week's <c>Building</c> cart (creating it on first use), one
/// reads any week's cart as it stands, and one confirms a week's cart. The reads
/// return the cart together with its items in one response shape and are open to
/// the hub and participants - the review a human does before the final tap. The
/// confirm is the sensitive action and is organizer-gated (Engineering Contract
/// 7.4). Work is handed to MediatR.
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
            return CartNotFound(householdId, weekIso);
        }

        return Ok(result.Cart);
    }

    /// <summary>
    /// Confirms a week's cart - the human on the final tap (G4, journey 6.4). It
    /// flips the week's single cart row to <c>Confirmed</c>, stamping the
    /// confirming organizer's person and the injected clock's time, under the
    /// cart's <c>If-Match</c> optimistic-concurrency precondition (so a cart that
    /// grew a line since the review is a <c>412</c> the organizer must re-read).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Confirming is a sensitive action, so this route carries the
    /// <c>Organizer</c> policy: a tap-to-claim participant session or the paired
    /// hub device may review a cart but is <c>403</c> here (Engineering Contract
    /// 7.4, mitigating BRD risk R-1).
    /// </para>
    /// <para>
    /// <b>No real order is placed and no money moves</b> (BRD decision D-8). The
    /// confirm records intent only: the sole effect is the cart row's own status,
    /// with no external store, HTTP, or payment call anywhere in the path.
    /// </para>
    /// <para>
    /// It is idempotent - confirming an already-<c>Confirmed</c> cart is a no-op
    /// success that returns the cart with its original who/when untouched, so a
    /// retried tap cannot rewrite the record of who confirmed. An unknown
    /// household and a week with no cart to confirm are distinct <c>404</c>
    /// problem details.
    /// </para>
    /// </remarks>
    [HttpPost("{weekIso}/confirm")]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(typeof(CartResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status412PreconditionFailed)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status428PreconditionRequired)]
    public async Task<ActionResult<CartResponse>> Confirm(
        string householdId,
        string weekIso,
        CancellationToken cancellationToken)
    {
        // The organizer's object id is the binding to their People row, exactly as
        // household creation stores it (Engineering Contract 7.4). The policy has
        // already established there is an organizer principal here.
        var organizerObjectId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;

        // The If-Match header is the optimistic-concurrency precondition (7.3);
        // its absence surfaces as 428 from the persistence seam.
        var ifMatch = Request.Headers.IfMatch.ToString();

        var result = await _sender.Send(
            new ConfirmCartCommand(householdId, weekIso, organizerObjectId, ifMatch),
            cancellationToken);

        if (!result.HouseholdExists)
        {
            return HouseholdNotFound(householdId);
        }

        if (result.Cart is null)
        {
            return CartNotFound(householdId, weekIso);
        }

        return Ok(result.Cart);
    }

    // RFC 7807 problem details for an unknown household (Engineering Contract 7.5).
    private ObjectResult HouseholdNotFound(string householdId) => Problem(
        statusCode: StatusCodes.Status404NotFound,
        title: "Household not found.",
        detail: $"No household with id '{householdId}' exists.",
        type: $"https://httpstatuses.io/{StatusCodes.Status404NotFound}");

    // The household exists but that week has no cart - a different 404 from an
    // unknown household, and told apart by its own problem document (7.5).
    private ObjectResult CartNotFound(string householdId, string weekIso) => Problem(
        statusCode: StatusCodes.Status404NotFound,
        title: "Cart not found.",
        detail: $"No cart for week '{weekIso}' exists in household '{householdId}'.",
        type: $"https://httpstatuses.io/{StatusCodes.Status404NotFound}");
}
