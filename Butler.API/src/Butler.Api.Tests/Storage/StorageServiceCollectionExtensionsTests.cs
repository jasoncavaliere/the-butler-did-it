using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Storage;

/// <summary>
/// Criterion: the storage composition seam wires the factory once and lets each
/// feature register its table with <c>AddTableRepository</c>, transparently
/// resolving to the in-memory fallback or the Table-backed store based on the
/// configuration flag - so no feature knows which store is in play.
/// </summary>
public sealed class StorageServiceCollectionExtensionsTests
{
    [Fact]
    public void AddStorage_registers_the_table_client_factory()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>());

        Assert.NotNull(provider.GetService<ITableClientFactory>());
    }

    [Fact]
    public void AddTableRepository_resolves_the_in_memory_store_when_nothing_is_configured()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>());

        var repository = provider.GetRequiredService<IEntityRepository<FakeEntity>>();

        Assert.IsType<InMemoryEntityRepository<FakeEntity>>(repository);
    }

    [Fact]
    public void AddTableRepository_resolves_the_in_memory_store_when_the_flag_is_set()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            ["Storage:ConnectionString"] = "UseDevelopmentStorage=true",
            ["Storage:UseInMemoryStore"] = "true",
        });

        Assert.IsType<InMemoryEntityRepository<FakeEntity>>(
            provider.GetRequiredService<IEntityRepository<FakeEntity>>());
    }

    [Fact]
    public void AddTableRepository_resolves_the_table_store_when_storage_is_configured()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            ["Storage:ConnectionString"] = "UseDevelopmentStorage=true",
        });

        Assert.IsType<TableEntityRepository<FakeEntity>>(
            provider.GetRequiredService<IEntityRepository<FakeEntity>>());
    }

    private static ServiceProvider BuildProvider(IDictionary<string, string?> settings)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(settings)
            .Build();

        var services = new ServiceCollection();
        services.AddStorage(configuration);
        services.AddTableRepository<FakeEntity>("FakeTable");
        return services.BuildServiceProvider();
    }
}
