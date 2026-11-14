using Butler.Api.Application.Households;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.People;
using Butler.Api.Infrastructure.Rooms;
using Butler.Api.Infrastructure.Storage;
using NSubstitute;

namespace Butler.Api.Tests.Households;

/// <summary>
/// Criteria (#124 AC1, AC3, AC4): teardown deletes nothing for an unknown
/// household or an inexact (ordinal, case-sensitive, untrimmed) confirmation
/// name; otherwise it runs every registered purger, the household row's last.
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
    public async Task Household_row_is_purged_last()
    {
        var result = await CreateService().TeardownAsync(HouseholdId, "Home");

        Assert.Equal(HouseholdTeardownResult.Deleted, result);
        Received.InOrder(() =>
        {
            _peoplePurger.PurgeAsync(HouseholdId, Arg.Any<CancellationToken>());
            _roomsPurger.PurgeAsync(HouseholdId, Arg.Any<CancellationToken>());
            _householdPurger.PurgeAsync(HouseholdId, Arg.Any<CancellationToken>());
        });
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
