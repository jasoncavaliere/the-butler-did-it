using Azure.Data.Tables;
using Butler.Api.Application.Concurrency;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.SmokeTests;

/// <summary>
/// Criterion (AC5-AC8): the production <see cref="IEntityRepository{TEntity}"/>
/// seam, composed exactly as the app composes it (<c>AddStorage</c> +
/// <c>AddTableRepository</c>), round-trips against a real Table backend (Azurite)
/// and enforces optimistic concurrency there.
/// </summary>
/// <remarks>
/// The seam signals concurrency outcomes as exceptions;
/// <c>Mediation/ApiExceptionHandler.cs</c> maps
/// <see cref="PreconditionRequiredException"/> to <c>428</c> and
/// <see cref="PreconditionFailedException"/> to <c>412</c>, so asserting the
/// exception type asserts the HTTP status a caller would see.
/// <para>
/// The app provisions only the tables its features register, and this
/// throwaway <c>Smoke{guid}</c> table is not one of them, so each test creates
/// it and drops it afterwards - real feature tables are never touched. Unreachable Azurite fails the test; it never skips.
/// </para>
/// </remarks>
[Trait(SmokeCategories.Name, SmokeCategories.Storage)]
public sealed class StorageRoundTripSmokeTests : IAsyncLifetime
{
    private readonly string _tableName = "Smoke" + Guid.NewGuid().ToString("N");
    private readonly string _householdId = "smoke-household-" + Guid.NewGuid().ToString("N");
    private readonly ServiceProvider _services;
    private readonly TableClient _table;

    public StorageRoundTripSmokeTests()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Storage:ConnectionString"] = SmokeSettings.Current.StorageConnectionString,
                ["Storage:UseInMemoryStore"] = "false",
            })
            .Build();

        _services = new ServiceCollection()
            .AddStorage(configuration)
            .AddTableRepository<SmokeEntity>(_tableName)
            .BuildServiceProvider();

        _table = _services.GetRequiredService<ITableClientFactory>().GetTableClient(_tableName);
    }

    private IEntityRepository<SmokeEntity> Repository =>
        _services.GetRequiredService<IEntityRepository<SmokeEntity>>();

    public async Task InitializeAsync() => await _table.CreateIfNotExistsAsync();

    public async Task DisposeAsync()
    {
        try
        {
            await _table.DeleteAsync();
        }
        finally
        {
            await _services.DisposeAsync();
        }
    }

    [Fact]
    public void Seam_resolves_the_table_backed_repository_not_the_in_memory_fallback()
    {
        Assert.IsType<TableEntityRepository<SmokeEntity>>(Repository);
    }

    [Fact]
    public async Task Create_read_update_with_if_match_round_trips_against_azurite()
    {
        var repository = Repository;

        await repository.AddAsync(_householdId, new SmokeEntity { RowKey = "item", Payload = "created" });

        var read = await repository.GetAsync(_householdId, "item");
        Assert.NotNull(read);
        Assert.Equal(_householdId, read.PartitionKey);
        Assert.Equal("created", read.Payload);
        var firstETag = read.ETag.ToString();
        Assert.False(string.IsNullOrWhiteSpace(firstETag), "A Table read must hand back an ETag.");

        read.Payload = "updated";
        await repository.UpdateAsync(_householdId, read, firstETag);

        var reread = await repository.GetAsync(_householdId, "item");
        Assert.NotNull(reread);
        Assert.Equal("updated", reread.Payload);
        Assert.NotEqual(firstETag, reread.ETag.ToString());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Update_without_if_match_is_rejected_428(string? ifMatch)
    {
        var repository = Repository;
        await repository.AddAsync(_householdId, new SmokeEntity { RowKey = "item", Payload = "original" });
        var read = await repository.GetAsync(_householdId, "item");
        Assert.NotNull(read);

        read.Payload = "should-not-land";
        await Assert.ThrowsAsync<PreconditionRequiredException>(
            () => repository.UpdateAsync(_householdId, read, ifMatch));

        var after = await repository.GetAsync(_householdId, "item");
        Assert.NotNull(after);
        Assert.Equal("original", after.Payload);
    }

    [Fact]
    public async Task Update_with_stale_etag_is_rejected_412()
    {
        var repository = Repository;
        await repository.AddAsync(_householdId, new SmokeEntity { RowKey = "item", Payload = "original" });
        var read = await repository.GetAsync(_householdId, "item");
        Assert.NotNull(read);
        var staleETag = read.ETag.ToString();

        // A first writer wins with the current ETag, which makes it stale.
        read.Payload = "first-writer";
        await repository.UpdateAsync(_householdId, read, staleETag);

        // A second writer still holding the original ETag is rejected by Azurite.
        var loser = new SmokeEntity { RowKey = "item", Payload = "second-writer" };
        await Assert.ThrowsAsync<PreconditionFailedException>(
            () => repository.UpdateAsync(_householdId, loser, staleETag));

        var after = await repository.GetAsync(_householdId, "item");
        Assert.NotNull(after);
        Assert.Equal("first-writer", after.Payload);
    }
}
