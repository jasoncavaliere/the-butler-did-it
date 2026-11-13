using Azure;
using Azure.Data.Tables;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace Butler.Api.Tests.Storage;

/// <summary>
/// Criteria (#91 AC1, AC2, AC4, AC5, AC6): the provisioner creates each distinct
/// registered table once in Table mode, logs the name of a table it cannot
/// create and rethrows so startup fails, never touches storage in in-memory
/// mode, and is safe to run again against tables that already exist. The
/// <see cref="TableClient"/>s are substituted, so no Azurite is needed.
/// </summary>
public sealed class TableProvisionerTests
{
    private const string Connection = "UseDevelopmentStorage=true";

    private readonly ITableClientFactory _factory = Substitute.For<ITableClientFactory>();
    private readonly Dictionary<string, TableClient> _clients = new(StringComparer.Ordinal);
    private readonly CapturingLogger<TableProvisioner> _logger = new();

    public TableProvisionerTests()
    {
        _factory.GetTableClient(Arg.Any<string>()).Returns(call =>
        {
            var name = call.Arg<string>();
            if (!_clients.TryGetValue(name, out var client))
            {
                client = Substitute.For<TableClient>();
                _clients[name] = client;
            }

            return client;
        });
    }

    [Fact]
    public void TableNames_are_distinct_case_insensitively_in_registration_order()
    {
        var provisioner = CreateProvisioner(
            new StorageOptions { ConnectionString = Connection },
            "Households", "People", "Rooms", "People", "people", "Chores");

        Assert.Equal(["Households", "People", "Rooms", "Chores"], provisioner.TableNames);
    }

    [Fact]
    public async Task ProvisionAsync_calls_CreateIfNotExists_for_each_table()
    {
        var provisioner = CreateProvisioner(
            new StorageOptions { ConnectionString = Connection },
            "Households", "People", "People");

        await provisioner.ProvisionAsync();

        Assert.Equal(["Households", "People"], _clients.Keys.Order(StringComparer.Ordinal));
        foreach (var client in _clients.Values)
        {
            await client.Received(1).CreateIfNotExistsAsync(Arg.Any<CancellationToken>());
        }

        var success = Assert.Single(_logger.Entries, entry => entry.EventId.Id == 9101);
        Assert.Equal(LogLevel.Information, success.Level);
        Assert.Contains("Households, People", success.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ProvisionAsync_passes_the_cancellation_token_through()
    {
        using var cancellation = new CancellationTokenSource();
        var provisioner = CreateProvisioner(new StorageOptions { ConnectionString = Connection }, "Households");

        await provisioner.ProvisionAsync(cancellation.Token);

        await _clients["Households"].Received(1).CreateIfNotExistsAsync(cancellation.Token);
    }

    [Fact]
    public async Task ProvisionAsync_twice_succeeds()
    {
        var provisioner = CreateProvisioner(
            new StorageOptions { ConnectionString = Connection },
            "Households", "People");

        await provisioner.ProvisionAsync();
        await provisioner.ProvisionAsync();

        foreach (var client in _clients.Values)
        {
            await client.Received(2).CreateIfNotExistsAsync(Arg.Any<CancellationToken>());
        }
    }

    [Fact]
    public async Task ProvisionAsync_logs_the_table_name_and_rethrows_when_create_fails()
    {
        var failure = new RequestFailedException(403, "This request is not authorized.");
        var rooms = Substitute.For<TableClient>();
        rooms.CreateIfNotExistsAsync(Arg.Any<CancellationToken>()).ThrowsAsync(failure);
        _clients["Rooms"] = rooms;
        var provisioner = CreateProvisioner(
            new StorageOptions { ConnectionString = Connection },
            "Households", "Rooms", "Chores");

        var thrown = await Assert.ThrowsAsync<RequestFailedException>(() => provisioner.ProvisionAsync());

        Assert.Same(failure, thrown);
        var error = Assert.Single(_logger.Entries, entry => entry.Level == LogLevel.Error);
        Assert.Equal(9102, error.EventId.Id);
        Assert.Contains("Rooms", error.Message, StringComparison.Ordinal);
        Assert.Same(failure, error.Exception);
        // Fails fast: the next table is never attempted and success is not logged.
        Assert.DoesNotContain("Chores", _clients.Keys);
        Assert.DoesNotContain(_logger.Entries, entry => entry.EventId.Id == 9101);
    }

    [Fact]
    public async Task ProvisionAsync_logs_the_table_name_when_no_storage_connection_is_configured()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Storage:UseInMemoryStore"] = "false" })
            .Build();
        using var provider = new ServiceCollection()
            .AddSingleton<ILogger<TableProvisioner>>(_logger)
            .AddStorage(configuration)
            .AddTableRepository<FakeEntity>("Households")
            .BuildServiceProvider();
        var provisioner = provider.GetRequiredService<TableProvisioner>();

        await Assert.ThrowsAsync<InvalidOperationException>(() => provisioner.ProvisionAsync());

        var error = Assert.Single(_logger.Entries, entry => entry.Level == LogLevel.Error);
        Assert.Contains("Households", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData(Connection, true)]
    public async Task ProvisionAsync_in_memory_mode_never_resolves_the_client_factory(string? connection, bool? useInMemory)
    {
        var services = Substitute.For<IServiceProvider>();
        var provisioner = new TableProvisioner(
            Options.Create(new StorageOptions { ConnectionString = connection, UseInMemoryStore = useInMemory }),
            [new TableRegistration("Households")],
            services,
            _logger);

        await provisioner.ProvisionAsync();

        Assert.Empty(services.ReceivedCalls());
        var skipped = Assert.Single(_logger.Entries);
        Assert.Equal(9103, skipped.EventId.Id);
        Assert.Equal(LogLevel.Debug, skipped.Level);
    }

    [Fact]
    public async Task StartAsync_runs_provisioning()
    {
        var provisioner = CreateProvisioner(new StorageOptions { ConnectionString = Connection }, "Households");
        var hosted = new TableProvisioningHostedService(provisioner);

        await hosted.StartAsync(CancellationToken.None);

        await _clients["Households"].Received(1).CreateIfNotExistsAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task StopAsync_completes()
    {
        var provisioner = CreateProvisioner(new StorageOptions { ConnectionString = Connection }, "Households");
        var hosted = new TableProvisioningHostedService(provisioner);

        await hosted.StopAsync(CancellationToken.None);

        Assert.Empty(_clients);
    }

    [Fact]
    public void Constructors_reject_null_dependencies()
    {
        var options = Options.Create(new StorageOptions());
        var services = Substitute.For<IServiceProvider>();
        TableRegistration[] registrations = [];

        Assert.Throws<ArgumentNullException>(() => new TableProvisioner(null!, registrations, services, _logger));
        Assert.Throws<ArgumentNullException>(() => new TableProvisioner(options, null!, services, _logger));
        Assert.Throws<ArgumentNullException>(() => new TableProvisioner(options, registrations, null!, _logger));
        Assert.Throws<ArgumentNullException>(() => new TableProvisioner(options, registrations, services, null!));
        Assert.Throws<ArgumentNullException>(() => new TableProvisioningHostedService(null!));
    }

    private TableProvisioner CreateProvisioner(StorageOptions options, params string[] tables)
    {
        var services = new ServiceCollection().AddSingleton(_factory).BuildServiceProvider();
        return new TableProvisioner(
            Options.Create(options),
            tables.Select(table => new TableRegistration(table)),
            services,
            _logger);
    }
}
