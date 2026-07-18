using Microsoft.AspNetCore.Mvc;
using DataAnnotationsValidationException = System.ComponentModel.DataAnnotations.ValidationException;

namespace Butler.Api.Tests.TestSupport;

/// <summary>
/// Test-only controller (compiled into the test assembly, added to the running
/// app as an application part by <see cref="ButlerApiFactory"/>). Each endpoint
/// throws a different exception so tests can drive a real request through the
/// wired <c>UseExceptionHandler</c> pipeline and assert the RFC 7807 mapping.
/// It is never part of the production app.
/// </summary>
[ApiController]
public sealed class ThrowingTestController : ControllerBase
{
    /// <summary>Throws a generic exception, which must map to <c>500</c>.</summary>
    [HttpGet("/test/unhandled")]
    public IActionResult Unhandled() =>
        throw new InvalidOperationException("deliberate failure from test endpoint");

    /// <summary>
    /// Throws <see cref="DataAnnotationsValidationException"/>, matched by the
    /// concrete-type arm of the handler and mapped to <c>400</c>.
    /// </summary>
    [HttpGet("/test/data-annotations-validation")]
    public IActionResult DataAnnotationsValidation() =>
        throw new DataAnnotationsValidationException("a required field was missing");

    /// <summary>
    /// Throws a differently-namespaced type named <c>ValidationException</c>,
    /// matched only by the fragile type-name arm and mapped to <c>400</c>.
    /// </summary>
    [HttpGet("/test/named-validation")]
    public IActionResult NamedValidation() =>
        throw new StandIn.ValidationException("type-name match validation failure");
}
