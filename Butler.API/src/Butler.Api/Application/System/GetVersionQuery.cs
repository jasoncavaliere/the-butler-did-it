using Butler.Api.Infrastructure.System;
using MediatR;

namespace Butler.Api.Application.System;

/// <summary>
/// Returns the build the API is running (#126): the git short SHA and UTC
/// build time stamped at build time, or <c>"dev"</c> when the build was not
/// stamped.
/// </summary>
public sealed record GetVersionQuery : IRequest<VersionResponse>;

/// <summary>Handles <see cref="GetVersionQuery"/>.</summary>
public sealed class GetVersionQueryHandler : IRequestHandler<GetVersionQuery, VersionResponse>
{
    private readonly IBuildVersionProvider _versions;

    public GetVersionQueryHandler(IBuildVersionProvider versions)
    {
        ArgumentNullException.ThrowIfNull(versions);
        _versions = versions;
    }

    public Task<VersionResponse> Handle(GetVersionQuery request, CancellationToken cancellationToken)
    {
        var version = _versions.GetVersion();
        return Task.FromResult(new VersionResponse(version.Sha, version.BuildTimeUtc));
    }
}
