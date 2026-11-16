using Butler.Api.Application.Households;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.People;
using Butler.Api.Infrastructure.Rooms;
using Butler.Api.Infrastructure.Storage;
using NSubstitute;

namespace Butler.Api.Tests.Households;

/// <summary>
/// Criteria (#124 AC1, AC3, AC4; #223 AC1, AC3, AC4): teardown deletes nothing
/// for an unknown household or an inexact (ordinal, case-sensitive, untrimmed)
/// confirmation name; otherwise it runs every registered purger, then the
/// household row's, then every other purger again, so a write that lands in an
/// already-purged table mid-teardown does not survive it.
/// Criteria (#294 AC1, AC3): when the household purge or the second sweep throws
/// or is cancelled, the household row is restored (with no request token) and
/// <see cref="HouseholdTeardownIncompleteException"/> is thrown, so a retry
/// finishes the purge.
/// Criteria (#336 AC1a, AC1b, AC3): when the request token is cancelled during
/// the household purge or the second sweep, the household row is still restored
/// and the cancellation is rethrown unchanged (not wrapped), so the API answers
/// <c>499</c> instead of a <c>500</c>.
/// </summary>
public sealed class HouseholdTeardownServiceTests
{
    private const string HouseholdId = "h1";

    private readonly IHouseholdRepository _households = Substitute.For<IHouseholdRepository>();
    private readonly IHouseholdPartitionPurger _householdPurger = PurgerFor(typeof(HouseholdEntity));
    private readonly IHouseholdPartitionPurger _peoplePurger = PurgerFor(typeof(PersonEntity));
    private readonly IHouseholdPartitionPurger _roomsPurger = PurgerFor(typeof(RoomEntity));

    public HouseholdTeardownServiceTests()
    {
        _households.GetAsync(HouseholdId, Arg.Any<CancellationToken>())
            .Returns(new HouseholdEntity { PartitionKey = HouseholdId, RowKey = HouseholdId, Name = "Home" });
    }

    private static IHouseholdPartitionPurger PurgerFor(Type entityType)
    {
        var purger = Substitute.For<IHouseholdPartitionPurger>();
        purger.EntityType.Returns(entityType);
        return purger;
    }

    // The household purger is registered first on purpose, so the test proves the
    // service reorders it rather than relying on registration order.
    private HouseholdTeardownService CreateService() =>
        new(_households, [_householdPurger, _peoplePurger, _roomsPurger]);

    private async Task AssertNothingPurgedAsync()
    {
        foreach (var purger in new[] { _householdPurger, _peoplePurger, _roomsPurger })
        {
            await purger.DidNotReceiveWithAnyArgs().PurgeAsync(default!, default);
        }
    }

    [Fact]
    public async Task NotFound_purges_nothing()
    {
        var result = await CreateService().TeardownAsync("unknown", "Home");

        Assert.Equal(HouseholdTeardownResult.NotFound, result);
        await AssertNothingPurgedAsync();
    }

    [Fact]
    public async Task NameMismatch_purges_nothing()
    {
        var result = await CreateService().TeardownAsync(HouseholdId, "Elsewhere");

        Assert.Equal(HouseholdTeardownResult.NameMismatch, result);
        await AssertNothingPurgedAsync();
    }

    [Theory]
    [InlineData("home")]
    [InlineData("HOME")]
    [InlineData("Home ")]
    [InlineData(" Home")]
    [InlineData("")]
    public async Task Comparison_is_ordinal_and_case_sensitive(string confirmName)
    {
        var result = await CreateService().TeardownAsync(HouseholdId, confirmName);

        Assert.Equal(HouseholdTeardownResult.NameMismatch, result);
        await AssertNothingPurgedAsync();
    }

    [Fact]
    public async Task Household_row_is_purged_after_every_table_then_tables_are_swept_again()
    {
        var result = await CreateService().TeardownAsync(HouseholdId, "Home");

        Assert.Equal(HouseholdTeardownResult.Deleted, result);
        Received.InOrder(() =>
        {
            _peoplePurger.PurgeAsync(HouseholdId, Arg.Any<CancellationToken>());
            _roomsPurger.PurgeAsync(HouseholdId, Arg.Any<CancellationToken>());
            _householdPurger.PurgeAsync(HouseholdId, Arg.Any<CancellationToken>());
            _peoplePurger.PurgeAsync(HouseholdId, Arg.Any<CancellationToken>());
            _roomsPurger.PurgeAsync(HouseholdId, Arg.Any<CancellationToken>());
        });
        await _householdPurger.Received(1).PurgeAsync(HouseholdId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task A_write_into_an_already_purged_table_does_not_survive_teardown()
    {
        var householdRows = new InMemoryEntityRepository<HouseholdEntity>();
        var people = new InMemoryEntityRepository<PersonEntity>();
        var rooms = new InMemoryEntityRepository<RoomEntity>();
        var households = new TableHouseholdRepository(householdRows);
        await households.AddAsync(new HouseholdEntity { RowKey = HouseholdId, Name = "Home" });
        await people.AddAsync(HouseholdId, new PersonEntity { RowKey = "organizer" });
        await rooms.AddAsync(HouseholdId, new RoomEntity { RowKey = "kitchen" });

        // People is purged before rooms, so the injected row lands in a table
        // the first sweep has already emptied.
        var injectingRooms = new WriteInjectingPurger(
            new HouseholdPartitionPurger<RoomEntity>(rooms),
            ct => people.AddAsync(HouseholdId, new PersonEntity { RowKey = "late" }, ct));
        var service = new HouseholdTeardownService(
            households,
            [new HouseholdPartitionPurger<HouseholdEntity>(householdRows), new HouseholdPartitionPurger<PersonEntity>(people), injectingRooms]);

        var result = await service.TeardownAsync(HouseholdId, "Home");

        Assert.Equal(HouseholdTeardownResult.Deleted, result);
        Assert.True(injectingRooms.Fired);
        Assert.Empty(await householdRows.ListAsync(HouseholdId));
        Assert.Empty(await people.ListAsync(HouseholdId));
        Assert.Empty(await rooms.ListAsync(HouseholdId));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_failure_after_sweep_one_restores_the_household_and_a_retry_finishes_the_purge(bool cancel)
    {
        var householdRows = new InMemoryEntityRepository<HouseholdEntity>();
        var people = new InMemoryEntityRepository<PersonEntity>();
        var rooms = new InMemoryEntityRepository<RoomEntity>();
        var households = new TableHouseholdRepository(householdRows);
        await households.AddAsync(new HouseholdEntity { RowKey = HouseholdId, Name = "Home" });
        await people.AddAsync(HouseholdId, new PersonEntity { RowKey = "organizer" });
        await rooms.AddAsync(HouseholdId, new RoomEntity { RowKey = "kitchen" });

        // The rooms purger writes a People row after People was swept, and the
        // People purger fails on its second call (sweep 2), so that row is left.
        // The cancellation has no request token cancelled, so it is still wrapped (#336).
        Exception failure = cancel ? new OperationCanceledException() : new InvalidOperationException("storage down");
        var failingPeople = new ThrowOnCallPurger(new HouseholdPartitionPurger<PersonEntity>(people), 2, failure);
        var injectingRooms = new WriteInjectingPurger(
            new HouseholdPartitionPurger<RoomEntity>(rooms),
            ct => people.AddAsync(HouseholdId, new PersonEntity { RowKey = "late" }, ct));
        var service = new HouseholdTeardownService(
            households,
            [new HouseholdPartitionPurger<HouseholdEntity>(householdRows), failingPeople, injectingRooms]);

        var thrown = await Assert.ThrowsAsync<HouseholdTeardownIncompleteException>(
            () => service.TeardownAsync(HouseholdId, "Home"));

        Assert.Same(failure, thrown.InnerException);
        Assert.Equal(HouseholdId, thrown.HouseholdId);
        Assert.Equal(2, failingPeople.Calls);
        Assert.NotNull(await households.GetAsync(HouseholdId));
        Assert.Single(await people.ListAsync(HouseholdId));

        Assert.Equal(HouseholdTeardownResult.Deleted, await service.TeardownAsync(HouseholdId, "Home"));
        Assert.Empty(await householdRows.ListAsync(HouseholdId));
        Assert.Empty(await people.ListAsync(HouseholdId));
        Assert.Empty(await rooms.ListAsync(HouseholdId));

        Assert.Equal(HouseholdTeardownResult.NotFound, await service.TeardownAsync(HouseholdId, "Home"));
    }

    [Fact]
    public async Task A_request_cancelled_in_sweep_two_restores_the_household_and_rethrows_the_cancellation()
    {
        var household = new HouseholdEntity { PartitionKey = HouseholdId, RowKey = HouseholdId, Name = "Home" };
        _households.GetAsync(HouseholdId, Arg.Any<CancellationToken>())
            .Returns(household, (HouseholdEntity?)null);
        using var cts = new CancellationTokenSource();
        var cancellation = new OperationCanceledException(cts.Token);
        var peopleCalls = 0;
        _peoplePurger.PurgeAsync(HouseholdId, Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                if (++peopleCalls < 2)
                {
                    return Task.FromResult(0);
                }

                // The request is aborted mid sweep 2.
                cts.Cancel();
                return Task.FromException<int>(cancellation);
            });

        var thrown = await Assert.ThrowsAsync<OperationCanceledException>(
            () => CreateService().TeardownAsync(HouseholdId, "Home", cts.Token));

        Assert.Same(cancellation, thrown);
        await _households.Received(1).GetAsync(HouseholdId, CancellationToken.None);
        await _households.Received(1).AddAsync(household, CancellationToken.None);
    }

    [Fact]
    public async Task A_request_cancelled_during_the_household_purge_restores_the_row_and_rethrows_the_cancellation()
    {
        var household = new HouseholdEntity { PartitionKey = HouseholdId, RowKey = HouseholdId, Name = "Home" };
        _households.GetAsync(HouseholdId, Arg.Any<CancellationToken>())
            .Returns(household, (HouseholdEntity?)null);
        using var cts = new CancellationTokenSource();
        var cancellation = new OperationCanceledException(cts.Token);
        _householdPurger.PurgeAsync(HouseholdId, Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                // The request is aborted while the household row is being deleted.
                cts.Cancel();
                return Task.FromException<int>(cancellation);
            });

        var thrown = await Assert.ThrowsAsync<OperationCanceledException>(
            () => CreateService().TeardownAsync(HouseholdId, "Home", cts.Token));

        Assert.Same(cancellation, thrown);
        await _households.Received(1).AddAsync(household, CancellationToken.None);
        await _peoplePurger.Received(1).PurgeAsync(HouseholdId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task A_household_purge_failure_that_left_the_row_in_place_is_not_re_added()
    {
        var failure = new InvalidOperationException("storage down");
        _householdPurger.PurgeAsync(HouseholdId, Arg.Any<CancellationToken>())
            .Returns(Task.FromException<int>(failure));

        var thrown = await Assert.ThrowsAsync<HouseholdTeardownIncompleteException>(
            () => CreateService().TeardownAsync(HouseholdId, "Home"));

        Assert.Same(failure, thrown.InnerException);
        await _households.DidNotReceiveWithAnyArgs().AddAsync(default!, default);
        await _peoplePurger.Received(1).PurgeAsync(HouseholdId, Arg.Any<CancellationToken>());
    }

    // Wraps a purger and throws the given exception on one numbered call instead
    // of delegating; every other call delegates.
    private sealed class ThrowOnCallPurger : IHouseholdPartitionPurger
    {
        private readonly IHouseholdPartitionPurger _inner;
        private readonly int _throwOnCall;
        private readonly Exception _exception;

        public ThrowOnCallPurger(IHouseholdPartitionPurger inner, int throwOnCall, Exception exception)
        {
            _inner = inner;
            _throwOnCall = throwOnCall;
            _exception = exception;
        }

        public int Calls { get; private set; }

        public Type EntityType => _inner.EntityType;

        public Task<int> PurgeAsync(string householdId, CancellationToken cancellationToken = default) =>
            ++Calls == _throwOnCall
                ? Task.FromException<int>(_exception)
                : _inner.PurgeAsync(householdId, cancellationToken);
    }

    // Wraps a purger and, on its first call only, runs a write before delegating,
    // simulating a request that commits between two purgers. One-shot, so the
    // second sweep does not re-inject and the test cannot pass vacuously.
    private sealed class WriteInjectingPurger : IHouseholdPartitionPurger
    {
        private readonly IHouseholdPartitionPurger _inner;
        private readonly Func<CancellationToken, Task> _write;

        public WriteInjectingPurger(IHouseholdPartitionPurger inner, Func<CancellationToken, Task> write)
        {
            _inner = inner;
            _write = write;
        }

        public bool Fired { get; private set; }

        public Type EntityType => _inner.EntityType;

        public async Task<int> PurgeAsync(string householdId, CancellationToken cancellationToken = default)
        {
            if (!Fired)
            {
                Fired = true;
                await _write(cancellationToken);
            }

            return await _inner.PurgeAsync(householdId, cancellationToken);
        }
    }

    [Fact]
    public async Task Teardown_guards_its_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => new HouseholdTeardownService(null!, []));
        Assert.Throws<ArgumentNullException>(() => new HouseholdTeardownService(_households, null!));
        Assert.Throws<ArgumentNullException>(() => new DeleteHouseholdCommandHandler(null!));

        await Assert.ThrowsAsync<ArgumentException>(() => CreateService().TeardownAsync(" ", "Home"));
    }
}
