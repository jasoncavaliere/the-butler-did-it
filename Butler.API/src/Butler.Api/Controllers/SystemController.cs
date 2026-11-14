using Butler.Api.Application.System;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Butler.Api.Controllers;

/// <summary>
/// Thin controller for the System feature. Endpoints do no work of their own;
/// they hand the request to MediatR via <c>_sender.Send(...)</c> and return the
/// result. This is the shape every feature controller follows.
/// </summary>
[ApiController]
[Route("api/system")]
[Tags("System")]
public sealed class SystemController : ControllerBase
{
    private readonly ISender _sender;

    public SystemController(ISender sender)
    {
        _sender = sender;
    }

    /// <summary>Liveness/round-trip check that exercises the MediatR pipeline.</summary>
    [HttpGet("ping")]
    [ProducesResponseType(typeof(PingResult), StatusCodes.Status200OK)]
    public async Task<ActionResult<PingResult>> Ping(CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new PingQuery(), cancellationToken);
        return Ok(result);
    }

    /// <summary>
    /// The deployment's current dataset id (#100 D7). The hub compares it with
    /// the id it last saw and drops its offline cache and write queue when it
    /// changed. Anonymous, like ping, and never cached.
    /// </summary>
    [HttpGet("dataset")]
    [ProducesResponseType(typeof(DatasetResponse), StatusCodes.Status200OK)]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<ActionResult<DatasetResponse>> Dataset(CancellationToken cancellationToken)
    {
        var result = await _sender.Send(new GetDatasetQuery(), cancellationToken);
        return Ok(result);
    }
}
