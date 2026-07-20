using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Auth;
using Butler.Api.Application.HubDevices;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for pairing a tablet as the household's hub device (T5).
/// Pairing is a sensitive action, so the whole controller carries the
/// <c>Organizer</c> policy (Engineering Contract 7.4): a participant session or an
/// anonymous caller is refused, while a signed-in organizer (or the dev organizer
/// in dev mode) can pair. Work is handed to MediatR.
/// </summary>
[ApiController]
[Route("households/{householdId}/hub-devices")]
[Authorize(Policy = OrganizerAuthorization.PolicyName)]
[Tags("HubDevices")]
public sealed class HubDevicesController : ControllerBase
{
    private readonly ISender _sender;

    public HubDevicesController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>
    /// Pairs the current tablet as a hub device and returns a long-lived device
    /// token scoped to the household (organizer only).
    /// </summary>
    [HttpPost("pair")]
    [ProducesResponseType(typeof(HubDevicePairingResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<HubDevicePairingResponse>> Pair(
        string householdId,
        [FromBody] PairHubDeviceRequest request,
        CancellationToken cancellationToken)
    {
        var result = await _sender.Send(
            new PairHubDeviceCommand(householdId, request.DeviceName),
            cancellationToken);

        return Ok(result);
    }
}

/// <summary>Request body for <c>POST /households/{householdId}/hub-devices/pair</c>.</summary>
/// <param name="DeviceName">The human-readable name for the paired tablet (required).</param>
public sealed record PairHubDeviceRequest(
    [Required(AllowEmptyStrings = false)] string DeviceName);
