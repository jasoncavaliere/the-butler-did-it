using System.Collections.Concurrent;
using Azure;
using Azure.Data.Tables;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace Butler.Api.Tests.Storage;

/// <summary>
/// Criteria (#91 AC1, AC2, AC4, AC5): booting the real <c>Program</c> in Table
/// mode creates every table the features register, each exactly once, before
/// the host is ready; a table that cannot be created fails startup with an
/// error naming it; and in in-memory mode no storage client is ever created.
/// The client factory is substituted, so no Azurite is needed - and no feature
/// endpoint is called, because the substitute clients hold no data.
/// </summary>
public sealed class TableProvisioningStartupTests
{
    /// <summary>The distinct feature tables, in the order Program registers them.</summary>
    private static readonly string[] FeatureTables =
    [
        "Datasets", "Households", "People", "Rooms", "Chores", "HubDevices",
        "Assignments", "ChoreCompletions", "Carts", "CartItems", "Events",
    ];

    private readonly ConcurrentDictionary<string, TableClient> _clients = new(StringComparer.Ordinal);
    private readonly CapturingLogger<TableProvisioner> _logger = new();
    private int _factoryResolutions;

    [Fact]
    public async Task Startup_in_table_mode_creates_each_registered_table_exactly_once()
    {
        using var factory = CreateFactory(tableMode: true);
        using var client = factory.CreateClient();

        Assert.Equal(FeatureTables.Order(StringComparer.Ordinal), _clients.Keys.Order(StringComparer.Ordinal));
        foreach (var table in _clients.Values)
        {
            await table.Received(1).CreateIfNotExistsAsync(Arg.Any<CancellationToken>());
        }

        Assert.Equal(FeatureTables, factory.Services.GetRequiredService<TableProvisioner>().TableNames);
    }

    [Fact]
    public void Startup_fails_when_a_table_cannot_be_created()
    {
        var failure = new RequestFailedException(403, "This request is not authorized.");
        var chores = Substitute.For<TableClient>();
        chores.CreateIfNotExistsAsync(Arg.Any<CancellationToken>()).ThrowsAsync(failure);
        _clients["Chores"] = chores;
        using var factory = CreateFactory(tableMode: true);

        var exception = Record.Exception(() => factory.CreateClient());

        Assert.NotNull(exception);
        Assert.Contains(failure, Unwrap(exception));
        var error = Assert.Single(_logger.Entries, entry => entry.Level == LogLevel.Error);
        Assert.Contains("Chores", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Startup_in_memory_mode_creates_no_storage_client()
    {
        using var factory = CreateFactory(tableMode: false);
        using var client = factory.CreateClient();

        using var health = await client.GetAsync(new Uri("/health", UriKind.Relative));

        Assert.True(health.IsSuccessStatusCode);
        Assert.Equal(0, _factoryResolutions);
        Assert.Empty(_clients);
    }

    private WebApplicationFactory<Program> CreateFactory(bool tableMode) =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            if (tableMode)
            {
                builder.UseSetting("Storage:ConnectionString", "UseDevelopmentStorage=true");
                builder.UseSetting("Storage:UseInMemoryStore", "false");
            }

            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ITableClientFactory>();
                services.AddSingleton(_ =>
                {
                    Interlocked.Increment(ref _factoryResolutions);
                    return CreateClientFactory();
                });
                services.RemoveAll<ILogger<TableProvisioner>>();
                services.AddSingleton<ILogger<TableProvisioner>>(_logger);
            });
        });

    private ITableClientFactory CreateClientFactory()
    {
        var factory = Substitute.For<ITableClientFactory>();
        factory.GetTableClient(Arg.Any<string>())
            .Returns(call => _clients.GetOrAdd(call.Arg<string>(), _ => Substitute.For<TableClient>()));
        return factory;
    }

    // The deferred host may wrap the startup exception; walk the chain.
    private static IEnumerable<Exception> Unwrap(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            yield return current;
            if (current is AggregateException aggregate)
            {
                foreach (var inner in aggregate.InnerExceptions.SelectMany(Unwrap))
                {
                    yield return inner;
                }
            }
        }
    }
}
