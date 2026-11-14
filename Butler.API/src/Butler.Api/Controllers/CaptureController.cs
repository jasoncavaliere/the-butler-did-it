using System.Security.Claims;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Capture;
using Butler.Api.Application.Carts;
using Butler.Api.Application.Grocery;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for grocery capture (G3, journey 6.4). One route per v1
/// <see cref="ICaptureSource"/> - typed at the hub, or a simulated voice
/// transcript - both landing in the same resolve-and-add handler, so the two
/// routes are transport differences rather than two behaviours. Adding to the cart
/// is not a sensitive action (decision D-3): any authenticated caller may do it,
/// including a tap-to-claim participant and the paired hub device. The organizer
/// gate lives on the G4 confirm.
/// </summary>
/// <remarks>
/// <b>Live Alexa capture is out of scope</b> (BRD Section 9 fast-follow). When it
/// ships it is a third source behind the same seam and a third route here.
/// </remarks>
[ApiController]
[Route("households/{householdId}/capture")]
[Tags("Capture")]
public sealed class CaptureController : ControllerBase
{
    private readonly ISender _sender;

    public CaptureController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>
    /// Captures text typed at the hub (for example <c>"add oat milk"</c>) and adds
    /// the resolved product to the household's current building cart, creating the
    /// week's cart on first use.
    /// </summary>
    /// <remarks>
    /// The item is attributed to the participant session's own <c>personId</c> when
    /// the caller holds one; otherwise (a shared hub tablet or an organizer) to the
    /// <c>personId</c> in the body - the UI's active participant. No resolvable
    /// actor is a <c>400</c>.
    /// <para>
    /// A term the store cannot match is a <c>200</c> with outcome <c>NoMatch</c>,
    /// no item, and an empty suggestions list, so the hub can offer to add it as a
    /// custom item. Several matches are a <c>400</c> carrying the suggestions, and
    /// a <c>404</c> now means only an unknown household.
    /// </para>
    /// </remarks>
    [HttpPost("text")]
    [Authorize]
    [ProducesResponseType(typeof(CaptureResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public Task<ActionResult<CaptureResponse>> Text(
        string householdId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] CaptureUtteranceRequest? request,
        CancellationToken cancellationToken) =>
        CaptureAsync(CaptureSourceNames.HubText, householdId, request, cancellationToken);

    /// <summary>
    /// Captures a simulated voice transcript (for example
    /// <c>"Hey Butler, add oat milk."</c>) through the same handler as
    /// <see cref="Text"/>. The wake word is stripped by the voice source; the
    /// resolve-and-add behaviour is identical.
    /// </summary>
    [HttpPost("voice")]
    [Authorize]
    [ProducesResponseType(typeof(CaptureResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status409Conflict)]
    public Task<ActionResult<CaptureResponse>> Voice(
        string householdId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] CaptureUtteranceRequest? request,
        CancellationToken cancellationToken) =>
        CaptureAsync(CaptureSourceNames.SimulatedVoice, householdId, request, cancellationToken);

    private async Task<ActionResult<CaptureResponse>> CaptureAsync(
        string captureSource,
        string householdId,
        CaptureUtteranceRequest? request,
        CancellationToken cancellationToken)
    {
        var personId = ResolveActorPersonId(request);
        if (string.IsNullOrWhiteSpace(personId))
        {
            return Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "A person is required to add to the cart.",
                detail: "Supply the acting personId in the request body, or present a participant session.",
                type: $"https://httpstatuses.io/{StatusCodes.Status400BadRequest}");
        }

        var result = await _sender.Send(
            new CaptureUtteranceCommand(
                captureSource,
                householdId,
                request?.Utterance ?? string.Empty,
                personId,
                request?.WeekIso,
                request?.Quantity),
            cancellationToken);

        return Map(householdId, result);
    }

    // Every outcome is a value, so the mapping is exhaustive and nothing here can
    // fall through to the exception handler as a 500. Item and WeekIso are
    // non-null on Added by construction, and WeekIso is non-null on NoMatch (see
    // CaptureResult's factories).
    private ActionResult<CaptureResponse> Map(string householdId, CaptureResult result) => result.Outcome switch
    {
        CaptureOutcome.Added => Ok(new CaptureResponse(
            nameof(CaptureOutcome.Added),
            result.CaptureSource,
            result.ResolvedTerm,
            result.WeekIso!,
            result.Item!,
            [])),

        // Nothing in the catalog: not an error, but an answer the hub acts on by
        // offering to add the term as a custom item. No suggestions in v1.
        CaptureOutcome.NoMatch => Ok(new CaptureResponse(
            nameof(CaptureOutcome.NoMatch),
            result.CaptureSource,
            result.ResolvedTerm,
            result.WeekIso!,
            null,
            [])),

        // Several plausible products: hand back the candidates so the shopper can
        // pick, rather than guessing one into the cart.
        CaptureOutcome.Ambiguous => CaptureProblem(
            StatusCodes.Status400BadRequest,
            "The utterance matched more than one product.",
            $"'{result.ResolvedTerm}' matched {result.Suggestions.Count} products. Pick one of the suggestions.",
            result),

        CaptureOutcome.EmptyTerm => CaptureProblem(
            StatusCodes.Status400BadRequest,
            "No product was recognised in the utterance.",
            "Say or type what to add, for example 'add oat milk'.",
            result),

        _ => Problem(
            statusCode: StatusCodes.Status404NotFound,
            title: "Household not found.",
            detail: $"No household with id '{householdId}' exists.",
            type: $"https://httpstatuses.io/{StatusCodes.Status404NotFound}"),
    };

    // RFC 7807 (Engineering Contract 7.5) plus the capture-specific members a
    // caller needs to recover: what Butler thought it heard, which source heard
    // it, and the candidate products when there were several.
    private static ObjectResult CaptureProblem(
        int statusCode,
        string title,
        string detail,
        CaptureResult result)
    {
        var problem = new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Detail = detail,
            Type = $"https://httpstatuses.io/{statusCode}",
        };

        problem.Extensions["captureSource"] = result.CaptureSource;
        problem.Extensions["resolvedTerm"] = result.ResolvedTerm;
        problem.Extensions["suggestions"] = result.Suggestions;

        return new ObjectResult(problem)
        {
            StatusCode = statusCode,
            ContentTypes = { "application/problem+json" },
        };
    }

    // The actor a captured item is attributed to, resolved exactly as a chore
    // completion resolves its actor (C4): a participant session identifies itself,
    // so its own personId is authoritative; a hub device or organizer is not a
    // person, so the active participant arrives in the body.
    private string? ResolveActorPersonId(CaptureUtteranceRequest? request)
    {
        if (User.IsInRole(OrganizerAuthorization.ParticipantRole))
        {
            return User.FindFirstValue(ClaimTypes.NameIdentifier);
        }

        return request?.PersonId;
    }
}

/// <summary>
/// Request body for the capture routes.
/// </summary>
/// <param name="Utterance">
/// What was typed or transcribed, for example <c>"add oat milk"</c>.
/// </param>
/// <param name="PersonId">
/// The acting person's id (the UI's active participant), used when the caller is a
/// hub device or organizer rather than a participant session. Ignored when a
/// participant session is present.
/// </param>
/// <param name="WeekIso">
/// The target ISO year-week, or <c>null</c> to add to the current week's cart.
/// </param>
/// <param name="Quantity">
/// How many to add, or <c>null</c> for the default of one. Quantities are never
/// parsed out of the utterance itself.
/// </param>
public sealed record CaptureUtteranceRequest(
    string? Utterance,
    string? PersonId,
    string? WeekIso,
    int? Quantity);

/// <summary>
/// A capture that reached the catalog: either the line that was added, or the
/// news that the store matched nothing, plus what the capture actually resolved
/// to, so the hub can echo "added Oat Milk" (or offer "add 'unicorn steaks' as a
/// custom item") and show which source heard it.
/// </summary>
/// <param name="Outcome">
/// <c>Added</c> or <c>NoMatch</c> (the <see cref="CaptureOutcome"/> name, as a
/// string).
/// </param>
/// <param name="CaptureSource">The <see cref="ICaptureSource"/> that handled the utterance.</param>
/// <param name="ResolvedTerm">The product term extracted from the utterance.</param>
/// <param name="WeekIso">The ISO year-week of the cart the item landed in (or would have).</param>
/// <param name="Item">The cart line that was created on <c>Added</c>; <c>null</c> on <c>NoMatch</c>.</param>
/// <param name="Suggestions">Candidate products; always empty for both outcomes in v1.</param>
public sealed record CaptureResponse(
    string Outcome,
    string CaptureSource,
    string ResolvedTerm,
    string WeekIso,
    CartItemView? Item,
    IReadOnlyList<StoreProduct> Suggestions);
