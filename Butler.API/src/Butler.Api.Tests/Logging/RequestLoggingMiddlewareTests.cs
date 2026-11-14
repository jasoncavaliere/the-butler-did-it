using System.Diagnostics;
using Butler.Api.Infrastructure.Logging;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Butler.Api.Tests.Logging;

/// <summary>
/// Unit tests for <see cref="RequestLoggingMiddleware"/> (#107 AC1, AC5): the
/// duration comes from the injected <see cref="TimeProvider"/> (Contract 7.5),
/// the event is written even when the pipeline throws, and with no ambient
/// <see cref="Activity"/> the correlation id falls back to
/// <see cref="HttpContext.TraceIdentifier"/> - the same fallback problem
/// details use for <c>traceId</c>.
/// </summary>
public sealed class RequestLoggingMiddlewareTests
{
    // Each GetTimestamp call advances a quarter second, so start -> end = 250 ms.
    private sealed class QuarterSecondClock : TimeProvider
    {
        private long _next;

        public override long GetTimestamp()
        {
            var value = _next;
            _next += TimestampFrequency / 4;
            return value;
        }
    }

    private static DefaultHttpContext NewContext()
    {
        var context = new DefaultHttpContext { TraceIdentifier = "trace-0001" };
        context.Request.Method = "GET";
        context.Request.Path = "/households/hh-unit/chores";
        context.Request.RouteValues["householdId"] = "hh-unit";
        return context;
    }

    [Fact]
    public async Task Logs_one_event_with_status_duration_household_and_trace_identifier()
    {
        var previous = Activity.Current;
        Activity.Current = null;
        try
        {
            var logger = new CapturingLogger<RequestLoggingMiddleware>();
            var middleware = new RequestLoggingMiddleware(
                ctx =>
                {
                    ctx.Response.StatusCode = StatusCodes.Status409Conflict;
                    return Task.CompletedTask;
                },
                new QuarterSecondClock(),
                logger);

            await middleware.InvokeAsync(NewContext());

            var entry = Assert.Single(logger.Entries);
            Assert.Equal(100, entry.EventId.Id);
            Assert.Equal(LogLevel.Information, entry.Level);
            Assert.Equal(
                "HTTP GET /households/hh-unit/chores responded 409 in 250 ms (household hh-unit, correlation trace-0001)",
                entry.Message);
        }
        finally
        {
            Activity.Current = previous;
        }
    }

    [Fact]
    public async Task Uses_the_ambient_activity_id_as_correlation_id()
    {
        using var activity = new Activity("request").Start();
        var logger = new CapturingLogger<RequestLoggingMiddleware>();
        var middleware = new RequestLoggingMiddleware(_ => Task.CompletedTask, new QuarterSecondClock(), logger);

        await middleware.InvokeAsync(NewContext());

        var entry = Assert.Single(logger.Entries);
        Assert.EndsWith($"correlation {activity.Id})", entry.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Still_logs_when_the_pipeline_throws()
    {
        var logger = new CapturingLogger<RequestLoggingMiddleware>();
        var middleware = new RequestLoggingMiddleware(
            _ => throw new InvalidOperationException("boom"),
            new QuarterSecondClock(),
            logger);

        await Assert.ThrowsAsync<InvalidOperationException>(() => middleware.InvokeAsync(NewContext()));

        var entry = Assert.Single(logger.Entries);
        Assert.Contains("household hh-unit", entry.Message, StringComparison.Ordinal);
    }
}
