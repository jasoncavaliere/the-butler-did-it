using System.Security.Claims;
using Butler.Api.Application.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Butler.Api.Controllers;

/// <summary>
/// Resolves the authenticated caller. This is the sample organizer-only endpoint
/// (Engineering Contract 7.4): it carries the <c>Organizer</c> policy, so it
/// returns the dev organizer in dev mode and the token subject otherwise, and
/// <c>401</c>/<c>403</c> when the policy is not satisfied.
/// </summary>
[ApiController]
[Route("me")]
[Authorize(Policy = OrganizerAuthorization.PolicyName)]
[Tags("Organizer")]
public sealed class MeController : ControllerBase
{
    /// <summary>Returns the resolved caller (subject and display name).</summary>
    [HttpGet]
    [ProducesResponseType(typeof(MeResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult<MeResponse> Get()
    {
        var subject = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var name = User.FindFirstValue(ClaimTypes.Name);
        return Ok(new MeResponse(subject, name));
    }
}

/// <summary>The resolved caller returned by <c>GET /me</c>.</summary>
/// <param name="Subject">The caller's stable subject (object id).</param>
/// <param name="Name">The caller's display name, when present.</param>
public sealed record MeResponse(string? Subject, string? Name);
