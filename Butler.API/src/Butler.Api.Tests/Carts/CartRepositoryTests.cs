using Butler.Api.Application.Concurrency;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Tests.Carts;

/// <summary>
/// Criteria (G2): the <c>Carts</c> table row is <c>PartitionKey = householdId</c>
/// / <c>RowKey = {weekIso}</c> with <c>Status</c>, <c>ConfirmedByPersonId</c>, and
/// <c>ConfirmedUtc</c>, reached only through <see cref="ICartRepository"/>. These
/// tests run the repository over the F3 in-memory store: a cart round-trips with
/// every field, households are isolated, and the update seam the confirm flow
/// (G4) uses enforces the shared optimistic-concurrency rules.
/// </summary>
public sealed class CartRepositoryTests
{
    private const string Week = "2026-W29";

    private static TableCartRepository NewRepository() =>
        new(new InMemoryEntityRepository<CartEntity>());

    private static CartEntity BuildingCart(string weekIso = Week) => new()
    {
        RowKey = weekIso,
        Status = CartStatus.Building,
    };

    [Fact]
    public async Task Add_then_get_round_trips_a_household_scoped_building_cart()
    {
        var repository = NewRepository();

        await repository.AddAsync("house-1", BuildingCart(), CancellationToken.None);

        var stored = await repository.GetAsync("house-1", Week, CancellationToken.None);
        Assert.NotNull(stored);
        Assert.Equal("house-1", stored!.PartitionKey);
        Assert.Equal(Week, stored.RowKey);
        Assert.Equal(CartStatus.Building, stored.Status);
        Assert.Null(stored.ConfirmedByPersonId);
        Assert.Null(stored.ConfirmedUtc);
        // A read hands back the version stamp a later mutation supplies as If-Match.
        Assert.NotEqual(string.Empty, stored.ETag.ToString());
    }

    [Fact]
    public async Task A_week_with_no_cart_reads_back_as_null()
    {
        var repository = NewRepository();

        Assert.Null(await repository.GetAsync("house-1", Week, CancellationToken.None));
    }

    [Fact]
    public async Task Get_does_not_cross_household_boundaries()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", BuildingCart(), CancellationToken.None);

        // The same week in another household is a separate, absent row.
        Assert.Null(await repository.GetAsync("house-2", Week, CancellationToken.None));
    }

    [Fact]
    public async Task Update_confirms_the_cart_under_a_matching_if_match()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", BuildingCart(), CancellationToken.None);
        var confirmedUtc = new DateTimeOffset(2026, 7, 18, 17, 30, 0, TimeSpan.Zero);

        var current = await repository.GetAsync("house-1", Week, CancellationToken.None);
        current!.Status = CartStatus.Confirmed;
        current.ConfirmedByPersonId = "person-1";
        current.ConfirmedUtc = confirmedUtc;
        await repository.UpdateAsync("house-1", current, current.ETag.ToString(), CancellationToken.None);

        var updated = await repository.GetAsync("house-1", Week, CancellationToken.None);
        Assert.Equal(CartStatus.Confirmed, updated!.Status);
        Assert.Equal("person-1", updated.ConfirmedByPersonId);
        Assert.Equal(confirmedUtc, updated.ConfirmedUtc);
    }

    [Fact]
    public async Task Update_without_an_if_match_is_rejected_as_428()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", BuildingCart(), CancellationToken.None);
        var current = await repository.GetAsync("house-1", Week, CancellationToken.None);

        // PreconditionRequiredException is what the shared handler maps to 428.
        await Assert.ThrowsAsync<PreconditionRequiredException>(
            () => repository.UpdateAsync("house-1", current!, null, CancellationToken.None));
    }

    [Fact]
    public async Task Update_with_a_stale_if_match_is_rejected_as_412()
    {
        var repository = NewRepository();
        await repository.AddAsync("house-1", BuildingCart(), CancellationToken.None);
        var current = await repository.GetAsync("house-1", Week, CancellationToken.None);

        // PreconditionFailedException is what the shared handler maps to 412.
        await Assert.ThrowsAsync<PreconditionFailedException>(
            () => repository.UpdateAsync("house-1", current!, "\"stale-etag\"", CancellationToken.None));
    }

    [Fact]
    public void Constructor_rejects_a_null_inner_repository()
    {
        Assert.Throws<ArgumentNullException>(() => new TableCartRepository(null!));
    }

    [Fact]
    public async Task AddAsync_rejects_a_null_cart_or_a_blank_week_key()
    {
        var repository = NewRepository();

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => repository.AddAsync("house-1", null!, CancellationToken.None));

        var blank = BuildingCart();
        blank.RowKey = string.Empty;
        await Assert.ThrowsAsync<ArgumentException>(
            () => repository.AddAsync("house-1", blank, CancellationToken.None));
    }

    [Fact]
    public async Task UpdateAsync_rejects_a_null_cart_or_a_blank_week_key()
    {
        var repository = NewRepository();

        await Assert.ThrowsAsync<ArgumentNullException>(
            () => repository.UpdateAsync("house-1", null!, "\"etag\"", CancellationToken.None));

        var blank = BuildingCart();
        blank.RowKey = string.Empty;
        await Assert.ThrowsAsync<ArgumentException>(
            () => repository.UpdateAsync("house-1", blank, "\"etag\"", CancellationToken.None));
    }

    [Theory]
    [InlineData(null, Week)]
    [InlineData("", Week)]
    [InlineData("house-1", null)]
    [InlineData("house-1", "")]
    public async Task GetAsync_rejects_a_blank_scope(string? householdId, string? weekIso)
    {
        var repository = NewRepository();

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => repository.GetAsync(householdId!, weekIso!, CancellationToken.None));
    }
}
