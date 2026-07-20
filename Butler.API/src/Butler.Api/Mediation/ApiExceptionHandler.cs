using Butler.Api.Application.Concurrency;
using Butler.Api.Application.People;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.Extensions.Logging;
using DataAnnotationsValidationException = System.ComponentModel.DataAnnotations.ValidationException;

namespace Butler.Api.Mediation;

/// <summary>
/// The single place unhandled exceptions become HTTP responses. Every error the
/// API returns is an RFC 7807 problem details document (Section 7.5). Validation
/// failures map to <c>400</c>; everything else maps to <c>500</c>.
/// </summary>
public sealed partial class ApiExceptionHandler : IExceptionHandler
{
    private readonly IProblemDetailsService _problemDetailsService;
    private readonly ILogger<ApiExceptionHandler> _logger;

    public ApiExceptionHandler(
        IProblemDetailsService problemDetailsService,
        ILogger<ApiExceptionHandler> logger)
    {
        _problemDetailsService = problemDetailsService;
        _logger = logger;
    }

    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        var (statusCode, title) = Classify(exception);

        if (statusCode >= StatusCodes.Status500InternalServerError)
        {
            LogUnhandled(exception, httpContext.Request.Method, httpContext.Request.Path);
        }
        else
        {
            LogValidationFailure(exception, httpContext.Request.Method, httpContext.Request.Path);
        }

        httpContext.Response.StatusCode = statusCode;

        return await _problemDetailsService.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails =
            {
                Status = statusCode,
                Title = title,
                Detail = exception.Message,
                Type = $"https://httpstatuses.io/{statusCode}",
            },
        });
    }

    private static (int StatusCode, string Title) Classify(Exception exception) => exception switch
    {
        // Optimistic-concurrency preconditions (Engineering Contract 7.3): a
        // missing If-Match is a 428, a stale one a 412.
        PreconditionRequiredException
            => (StatusCodes.Status428PreconditionRequired, "If-Match header is required."),
        PreconditionFailedException
            => (StatusCodes.Status412PreconditionFailed, "The resource was modified by another request."),
        // A household must always retain at least one organizer (issue #12).
        LastOrganizerException
            => (StatusCodes.Status400BadRequest, "A household must retain an organizer."),
        DataAnnotationsValidationException => (StatusCodes.Status400BadRequest, "Validation failed."),
        // Validators that ship with later features (for example FluentValidation)
        // are surfaced by matching on the type name, so this handler does not
        // take a dependency on a validation library that is not referenced yet.
        _ when exception.GetType().Name == "ValidationException"
            => (StatusCodes.Status400BadRequest, "Validation failed."),
        _ => (StatusCodes.Status500InternalServerError, "An unexpected error occurred."),
    };

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Error,
        Message = "Unhandled exception processing {Method} {Path}")]
    private partial void LogUnhandled(Exception exception, string method, string path);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Warning,
        Message = "Request failed validation for {Method} {Path}")]
    private partial void LogValidationFailure(Exception exception, string method, string path);
}
