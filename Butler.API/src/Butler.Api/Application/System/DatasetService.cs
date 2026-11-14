using Butler.Api.Infrastructure.System;

namespace Butler.Api.Application.System;

/// <summary>
/// Default <see cref="IDatasetService"/>. Both operations run under one
/// <see cref="SemaphoreSlim"/>, so concurrent first reads in this process agree
/// on one id and a regenerate never interleaves with a create. Ids use the
/// <c>Guid.NewGuid().ToString("N")</c> format every other server id uses, and
/// the creation stamp comes from the injected clock (Engineering Contract 7.5).
/// Register it as a singleton so the lock is shared across requests.
/// </summary>
public sealed class DatasetService : IDatasetService, IDisposable
{
    private readonly IDatasetRepository _repository;
    private readonly TimeProvider _clock;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public DatasetService(IDatasetRepository repository, TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(clock);
        _repository = repository;
        _clock = clock;
    }

    /// <inheritdoc />
    public async Task<string> GetOrCreateAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var stored = await _repository.GetAsync(cancellationToken).ConfigureAwait(false);
            if (stored is not null && !string.IsNullOrWhiteSpace(stored.DatasetId))
            {
                return stored.DatasetId;
            }

            var created = NewDataset();
            if (stored is null)
            {
                await _repository.AddAsync(created, cancellationToken).ConfigureAwait(false);
            }
            else
            {
                // A row with no id is unusable; replace it rather than fail.
                await _repository.UpsertAsync(created, cancellationToken).ConfigureAwait(false);
            }

            return created.DatasetId;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<string> RegenerateAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var created = NewDataset();
            await _repository.UpsertAsync(created, cancellationToken).ConfigureAwait(false);
            return created.DatasetId;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public void Dispose() => _gate.Dispose();

    private DatasetEntity NewDataset() => new()
    {
        PartitionKey = DatasetEntity.Partition,
        RowKey = DatasetEntity.Row,
        DatasetId = Guid.NewGuid().ToString("N"),
        CreatedUtc = _clock.GetUtcNow(),
    };
}
