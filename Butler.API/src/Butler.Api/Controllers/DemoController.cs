using System.Security.Claims;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Demo;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for the demo seeder (#97). Organizer-only. Outside the
/// Development and Demo environments the seeder refuses and the request is a
/// <c>404</c>.
/// </summary>
[ApiController]
[Route("demo")]
[Tags("Demo")]
public sealed class DemoController : ControllerBase
{
    private readonly ISender _sender;

    public DemoController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>
    /// Seeds the demo household at the stable id <c>demo-household</c>, replacing
    /// any previous demo household, with the caller as its hidden organizer.
    /// </summary>
    [HttpPost("seed")]
    [Authorize(Policy = OrganizerAuthorization.PolicyName)]
    [ProducesResponseType(typeof(DemoSeedResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<DemoSeedResponse>> Seed(CancellationToken cancellationToken)
    {
        var organizerObjectId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var organizerDisplayName = User.FindFirstValue(ClaimTypes.Name);

        var result = await _sender.Send(
            new SeedDemoHouseholdCommand(organizerObjectId, organizerDisplayName),
            cancellationToken);

        return Ok(result);
    }
}
