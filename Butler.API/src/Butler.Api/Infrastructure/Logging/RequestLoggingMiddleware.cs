using System.Diagnostics;

namespace Butler.Api.Infrastructure.Logging;

/// <summary>
/// Logs one structured summary event per request (Demo only, #107): method,
/// path, final status code, elapsed milliseconds (from the injected
/// <see cref="TimeProvider"/>, Contract 7.5), the <c>householdId</c> route value
/// when the route has one, and the correlation id. The correlation id is the
/// same value RFC 7807 problem details carry as <c>traceId</c>
/// (<c>Activity.Current?.Id ?? HttpContext.TraceIdentifier</c>), so a client's
/// error body can be matched to its log line.
/// </summary>
internal sealed partial class RequestLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<RequestLoggingMiddleware> _logger;

    public RequestLoggingMiddleware(
        RequestDelegate next,
        TimeProvider timeProvider,
        ILogger<RequestLoggingMiddleware> logger)
    {
        _next = next;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var start = _timeProvider.GetTimestamp();

        // Routing has already run (WebApplication puts UseRouting in front of
        // this middleware). Read the route value now: the exception handler
        // clears RouteValues when it re-executes the pipeline for a 500.
        var householdId = context.GetRouteValue("householdId") as string;

        try
        {
            await _next(context);
        }
        finally
        {
            var elapsedMs = _timeProvider.GetElapsedTime(start).TotalMilliseconds;
            var path = context.Request.Path.ToString();

            LogRequest(
                context.Request.Method,
                path,
                context.Response.StatusCode,
                elapsedMs,
                householdId,
                Activity.Current?.Id ?? context.TraceIdentifier);
        }
    }

    [LoggerMessage(
        EventId = 100,
        Level = LogLevel.Information,
        Message = "HTTP {Method} {Path} responded {StatusCode} in {ElapsedMs} ms (household {HouseholdId}, correlation {CorrelationId})")]
    private partial void LogRequest(
        string method,
        string path,
        int statusCode,
        double elapsedMs,
        string? householdId,
        string correlationId);
}
