using Butler.Api.Application.System;
using MediatR;

namespace Butler.Api.Application.Demo;

/// <summary>
/// Replaces the deployment's dataset id (#100 D7) with a new one and returns it,
/// without reseeding (#99). <c>demo restore</c> calls it after it copies a
/// snapshot back, so the hub sees a dataset id it has never seen and drops its
/// offline cache and queued writes.
/// </summary>
public sealed record RegenerateDemoDatasetCommand : IRequest<DatasetResponse>;

/// <summary>Handles <see cref="RegenerateDemoDatasetCommand"/> via the dataset service.</summary>
public sealed class RegenerateDemoDatasetCommandHandler : IRequestHandler<RegenerateDemoDatasetCommand, DatasetResponse>
{
    private readonly IDatasetService _datasets;

    public RegenerateDemoDatasetCommandHandler(IDatasetService datasets)
    {
        ArgumentNullException.ThrowIfNull(datasets);
        _datasets = datasets;
    }

    public async Task<DatasetResponse> Handle(RegenerateDemoDatasetCommand request, CancellationToken cancellationToken)
    {
        var datasetId = await _datasets.RegenerateAsync(cancellationToken).ConfigureAwait(false);
        return new DatasetResponse(datasetId);
    }
}
