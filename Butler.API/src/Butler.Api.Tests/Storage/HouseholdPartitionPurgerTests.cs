using Butler.Api.Application.Concurrency;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace Butler.Api.Tests.Storage;

/// <summary>
/// Criteria (#124 AC2, AC6): the per-table purger that household teardown runs
/// deletes every row in the given household's partition and nothing else, skips
/// a row that vanished between the list and the delete, and reports how many
/// rows it deleted.
/// </summary>
public sealed class HouseholdPartitionPurgerTests
{
    [Fact]
    public async Task Purger_deletes_only_the_given_partition()
    {
        var repository = new InMemoryEntityRepository<FakeEntity>();
        await repository.AddAsync("a", new FakeEntity { RowKey = "1" });
        await repository.AddAsync("a", new FakeEntity { RowKey = "2" });
        await repository.AddAsync("b", new FakeEntity { RowKey = "1" });
        var purger = new HouseholdPartitionPurger<FakeEntity>(repository);

        var deleted = await purger.PurgeAsync("a");

        Assert.Equal(2, deleted);
        Assert.Empty(await repository.ListAsync("a"));
        var survivor = Assert.Single(await repository.ListAsync("b"));
        Assert.Equal("1", survivor.RowKey);
    }

    [Fact]
    public async Task Purger_of_an_empty_partition_deletes_nothing()
    {
        var purger = new HouseholdPartitionPurger<FakeEntity>(new InMemoryEntityRepository<FakeEntity>());

        Assert.Equal(0, await purger.PurgeAsync("a"));
    }

    [Fact]
    public async Task Purger_tolerates_a_row_that_vanished_mid_purge()
    {
        var repository = Substitute.For<IEntityRepository<FakeEntity>>();
        repository.ListAsync("a", Arg.Any<CancellationToken>()).Returns(
        [
            new FakeEntity { PartitionKey = "a", RowKey = "gone" },
            new FakeEntity { PartitionKey = "a", RowKey = "here" },
        ]);
        repository
            .DeleteAsync("a", "gone", OptimisticConcurrency.Wildcard, Arg.Any<CancellationToken>())
            .ThrowsAsync(new PreconditionFailedException());
        var purger = new HouseholdPartitionPurger<FakeEntity>(repository);

        var deleted = await purger.PurgeAsync("a");

        // The vanished row is not counted, and the purge carried on past it.
        Assert.Equal(1, deleted);
        await repository.Received(1)
            .DeleteAsync("a", "here", OptimisticConcurrency.Wildcard, Arg.Any<CancellationToken>());
    }

    [Fact]
    public void Purger_reports_its_entity_type()
    {
        var purger = new HouseholdPartitionPurger<FakeEntity>(new InMemoryEntityRepository<FakeEntity>());

        Assert.Equal(typeof(FakeEntity), purger.EntityType);
    }

    [Fact]
    public async Task Purger_guards_its_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => new HouseholdPartitionPurger<FakeEntity>(null!));

        var purger = new HouseholdPartitionPurger<FakeEntity>(new InMemoryEntityRepository<FakeEntity>());
        await Assert.ThrowsAsync<ArgumentException>(() => purger.PurgeAsync(" "));
    }
}
