using Microsoft.Extensions.Hosting;

namespace Butler.Api.Infrastructure.Storage;

/// <summary>
/// Runs <see cref="TableProvisioner"/> as the host starts (#91). It is a plain
/// <see cref="IHostedService"/>, not a <c>BackgroundService</c>: the host awaits
/// <see cref="StartAsync"/> before the server begins listening, so every table
/// exists before the API accepts a request, and a failure stops startup.
/// </summary>
public sealed class TableProvisioningHostedService : IHostedService
{
    private readonly TableProvisioner _provisioner;

    public TableProvisioningHostedService(TableProvisioner provisioner)
    {
        ArgumentNullException.ThrowIfNull(provisioner);
        _provisioner = provisioner;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken) =>
        _provisioner.ProvisionAsync(cancellationToken);

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
