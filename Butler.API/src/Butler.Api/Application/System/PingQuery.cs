using Butler.Api.Infrastructure.System;
using MediatR;

namespace Butler.Api.Application.System;

/// <summary>
/// The reference vertical slice: a trivial query that proves the
/// HTTP -&gt; Controller -&gt; MediatR -&gt; Handler -&gt; Infrastructure -&gt; Domain
/// path end to end.
/// </summary>
public sealed record PingQuery : IRequest<PingResult>;

/// <summary>Result of a <see cref="PingQuery"/>.</summary>
/// <param name="Status">Always <c>"ok"</c> when the API is serving requests.</param>
/// <param name="Service">Logical service name.</param>
/// <param name="TimestampUtc">Server time the ping was handled.</param>
public sealed record PingResult(string Status, string Service, DateTimeOffset TimestampUtc);

/// <summary>Handles <see cref="PingQuery"/>.</summary>
public sealed class PingQueryHandler : IRequestHandler<PingQuery, PingResult>
{
    private readonly ISystemStatusProvider _statusProvider;
    private readonly TimeProvider _timeProvider;

    public PingQueryHandler(ISystemStatusProvider statusProvider, TimeProvider timeProvider)
    {
        _statusProvider = statusProvider;
        _timeProvider = timeProvider;
    }

    public Task<PingResult> Handle(PingQuery request, CancellationToken cancellationToken)
    {
        var status = _statusProvider.GetStatus();
        var result = new PingResult(status.Status, status.Service, _timeProvider.GetUtcNow());
        return Task.FromResult(result);
    }
}
