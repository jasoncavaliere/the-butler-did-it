using MediatR;

namespace Butler.Api.Application.System;

/// <summary>
/// Returns the deployment's current dataset id (#100 D7), minting one when none
/// is stored.
/// </summary>
public sealed record GetDatasetQuery : IRequest<DatasetResponse>;

/// <summary>Handles <see cref="GetDatasetQuery"/>.</summary>
public sealed class GetDatasetQueryHandler : IRequestHandler<GetDatasetQuery, DatasetResponse>
{
    private readonly IDatasetService _datasets;

    public GetDatasetQueryHandler(IDatasetService datasets)
    {
        ArgumentNullException.ThrowIfNull(datasets);
        _datasets = datasets;
    }

    public async Task<DatasetResponse> Handle(GetDatasetQuery request, CancellationToken cancellationToken)
    {
        var datasetId = await _datasets.GetOrCreateAsync(cancellationToken).ConfigureAwait(false);
        return new DatasetResponse(datasetId);
    }
}
