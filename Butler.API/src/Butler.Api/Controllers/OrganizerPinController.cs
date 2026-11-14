using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.Auth;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for the local demo PIN organizer (#105). Mapped only when
/// <c>Authentication:Provider</c> is <c>Pin</c> (Development or Demo); otherwise
/// <c>/auth/pin/*</c> is <c>404</c>. Both actions are anonymous: sign-in is how
/// an organizer gets a token, and sign-out is idempotent.
/// </summary>
[ApiController]
[Route("auth/pin")]
[AllowAnonymous]
[Tags("Organizer")]
public sealed class OrganizerPinController : ControllerBase
{
    private readonly ISender _sender;

    public OrganizerPinController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>
    /// Exchanges the demo PIN for a short-lived organizer token: <c>200</c>, a
    /// <c>401</c> problem for a wrong PIN, or a <c>429</c> problem (with
    /// <c>Retry-After</c>) while locked out after too many wrong PINs.
    /// </summary>
    [HttpPost("sign-in")]
    [ProducesResponseType(typeof(PinSignInResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<PinSignInResponse>> SignIn(
        [FromBody] PinSignInRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var result = await _sender.Send(new SignInWithPinCommand(request.Pin), cancellationToken);

        switch (result.Outcome)
        {
            case PinSignInOutcome.SignedIn:
                return Ok(new PinSignInResponse(
                    result.Token!,
                    OrganizerAuthorization.DevOrganizerSubject,
                    OrganizerAuthorization.PinOrganizerName,
                    (int)result.IdleTimeout.TotalSeconds));

            case PinSignInOutcome.LockedOut:
                var retryAfterSeconds = Math.Max(1, (int)Math.Ceiling(result.RetryAfter.TotalSeconds));
                var problem = ProblemDetailsFactory.CreateProblemDetails(
                    HttpContext,
                    statusCode: StatusCodes.Status429TooManyRequests,
                    title: "Too many PIN attempts.",
                    type: $"https://httpstatuses.io/{StatusCodes.Status429TooManyRequests}",
                    detail: $"Too many wrong PINs. Try again in {retryAfterSeconds} seconds.");
                problem.Extensions["retryAfterSeconds"] = retryAfterSeconds;
                Response.Headers[HeaderNames.RetryAfter] = retryAfterSeconds.ToString(CultureInfo.InvariantCulture);
                return new ObjectResult(problem) { StatusCode = StatusCodes.Status429TooManyRequests };

            default:
                return Problem(
                    statusCode: StatusCodes.Status401Unauthorized,
                    title: "The PIN is not correct.",
                    detail: "The organizer PIN is not correct.",
                    type: $"https://httpstatuses.io/{StatusCodes.Status401Unauthorized}");
        }
    }

    /// <summary>
    /// Revokes the presented organizer bearer token. Always <c>204</c>: a missing,
    /// unknown, or expired token is already signed out.
    /// </summary>
    [HttpPost("sign-out")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> SignOutOrganizer(CancellationToken cancellationToken)
    {
        var token = PinOrganizerAuthenticationHandler.ReadBearerToken(
            Request.Headers[HeaderNames.Authorization].ToString());

        await _sender.Send(new SignOutPinCommand(token), cancellationToken);

        return NoContent();
    }
}

/// <summary>Request body for <c>POST /auth/pin/sign-in</c>.</summary>
/// <param name="Pin">The organizer PIN (required).</param>
public sealed record PinSignInRequest(
    [Required(AllowEmptyStrings = false)] string Pin);
