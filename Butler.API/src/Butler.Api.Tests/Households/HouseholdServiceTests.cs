using Butler.Api.Application.Auth;
using Butler.Api.Application.Households;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.People;
using Butler.Api.Infrastructure.Storage;
using NSubstitute;

namespace Butler.Api.Tests.Households;

/// <summary>
/// Unit tests for <see cref="HouseholdService"/> exercised directly against
/// NSubstitute fakes of the persistence seams and a fixed clock. They pin the
/// orchestration H1 promises: the household and organizer rows are written
/// together, the organizer row defaults its display name, and the service fails
/// loudly if the just-created household cannot be read back.
/// </summary>
public sealed class HouseholdServiceTests
{
    private static readonly DateTimeOffset FixedNow =
        new(2026, 7, 19, 10, 30, 0, TimeSpan.Zero);

    [Fact]
    public async Task CreateAsync_writes_household_and_organizer_row_and_returns_persisted_etag()
    {
        var households = Substitute.For<IHouseholdRepository>();
        var people = Substitute.For<IEntityRepository<PersonEntity>>();

        HouseholdEntity? addedHousehold = null;
        households
            .When(r => r.AddAsync(Arg.Any<HouseholdEntity>(), Arg.Any<CancellationToken>()))
            .Do(ci => addedHousehold = ci.Arg<HouseholdEntity>());
        // The re-read returns the stored household stamped with its persisted ETag.
        households
            .GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                addedHousehold!.ETag = new Azure.ETag("persisted-etag");
                return addedHousehold;
            });

        PersonEntity? addedPerson = null;
        string? personHousehold = null;
        people
            .When(r => r.AddAsync(Arg.Any<string>(), Arg.Any<PersonEntity>(), Arg.Any<CancellationToken>()))
            .Do(ci =>
            {
                personHousehold = ci.Arg<string>();
                addedPerson = ci.Arg<PersonEntity>();
            });

        var clock = Substitute.For<TimeProvider>();
        clock.GetUtcNow().Returns(FixedNow);

        var service = new HouseholdService(households, people, clock);

        // No display name supplied -> the organizer row falls back to the default.
        var result = await service.CreateAsync("Cavaliere House", "org-object-id", null, CancellationToken.None);

        // Household row: server-generated id used as both keys, clock-stamped.
        Assert.NotNull(addedHousehold);
        Assert.False(string.IsNullOrWhiteSpace(addedHousehold!.RowKey));
        Assert.Equal(addedHousehold.RowKey, addedHousehold.PartitionKey);
        Assert.Equal("Cavaliere House", addedHousehold.Name);
        Assert.Equal("org-object-id", addedHousehold.OrganizerObjectId);
        Assert.Equal(FixedNow, addedHousehold.CreatedUtc);
        Assert.Null(addedHousehold.Timestamp);

        // Organizer People row seeded in the same household partition.
        Assert.NotNull(addedPerson);
        Assert.Equal(addedHousehold.RowKey, personHousehold);
        Assert.Equal(OrganizerAuthorization.OrganizerRole, addedPerson!.Role);
        Assert.False(addedPerson.IsChild);
        Assert.Equal("org-object-id", addedPerson.OrganizerObjectId);
        Assert.Equal("Organizer", addedPerson.DisplayName);
        Assert.Null(addedPerson.ClaimColor);
        Assert.Null(addedPerson.Timestamp);

        // The response projects the re-read household, including the persisted ETag.
        Assert.Equal(addedHousehold.RowKey, result.HouseholdId);
        Assert.Equal("Cavaliere House", result.Name);
        Assert.Equal("org-object-id", result.OrganizerObjectId);
        Assert.Equal(FixedNow, result.CreatedUtc);
        Assert.Equal("persisted-etag", result.ETag);
    }

    [Fact]
    public async Task CreateAsync_uses_the_supplied_organizer_display_name_when_present()
    {
        var households = Substitute.For<IHouseholdRepository>();
        var people = Substitute.For<IEntityRepository<PersonEntity>>();
        households
            .GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(ci => new HouseholdEntity { RowKey = ci.Arg<string>() });

        PersonEntity? addedPerson = null;
        people
            .When(r => r.AddAsync(Arg.Any<string>(), Arg.Any<PersonEntity>(), Arg.Any<CancellationToken>()))
            .Do(ci => addedPerson = ci.Arg<PersonEntity>());

        var clock = Substitute.For<TimeProvider>();
        clock.GetUtcNow().Returns(FixedNow);

        var service = new HouseholdService(households, people, clock);

        await service.CreateAsync("House", "org-object-id", "Jason", CancellationToken.None);

        Assert.Equal("Jason", addedPerson!.DisplayName);
    }

    [Fact]
    public async Task CreateAsync_throws_when_the_created_household_cannot_be_read_back()
    {
        var households = Substitute.For<IHouseholdRepository>();
        var people = Substitute.For<IEntityRepository<PersonEntity>>();
        // Add succeeds, but the re-read returns nothing.
        households
            .GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((HouseholdEntity?)null);

        var clock = Substitute.For<TimeProvider>();
        clock.GetUtcNow().Returns(FixedNow);

        var service = new HouseholdService(households, people, clock);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.CreateAsync("House", "org-object-id", "Jason", CancellationToken.None));
    }

    [Fact]
    public async Task CreateWithIdAsync_uses_the_supplied_id_and_seeds_the_organizer()
    {
        var households = Substitute.For<IHouseholdRepository>();
        var people = Substitute.For<IEntityRepository<PersonEntity>>();

        HouseholdEntity? addedHousehold = null;
        households
            .When(r => r.AddAsync(Arg.Any<HouseholdEntity>(), Arg.Any<CancellationToken>()))
            .Do(ci => addedHousehold = ci.Arg<HouseholdEntity>());
        households
            .GetAsync("demo-household", Arg.Any<CancellationToken>())
            .Returns(_ => addedHousehold);

        string? personHousehold = null;
        PersonEntity? addedPerson = null;
        people
            .When(r => r.AddAsync(Arg.Any<string>(), Arg.Any<PersonEntity>(), Arg.Any<CancellationToken>()))
            .Do(ci =>
            {
                personHousehold = ci.Arg<string>();
                addedPerson = ci.Arg<PersonEntity>();
            });

        var clock = Substitute.For<TimeProvider>();
        clock.GetUtcNow().Returns(FixedNow);

        var service = new HouseholdService(households, people, clock);

        var result = await service.CreateWithIdAsync(
            "demo-household", "The Parker Household", "org-object-id", "Organizer Name", CancellationToken.None);

        Assert.Equal("demo-household", result.HouseholdId);
        Assert.Equal("demo-household", addedHousehold!.PartitionKey);
        Assert.Equal("demo-household", addedHousehold.RowKey);
        Assert.Equal("demo-household", personHousehold);
        Assert.Equal(OrganizerAuthorization.OrganizerRole, addedPerson!.Role);
        Assert.Equal("org-object-id", addedPerson.OrganizerObjectId);
        Assert.Equal("Organizer Name", addedPerson.DisplayName);
        Assert.NotEqual("demo-household", addedPerson.RowKey);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    public async Task CreateWithIdAsync_rejects_a_blank_id(string householdId)
    {
        var households = Substitute.For<IHouseholdRepository>();
        var service = new HouseholdService(households, Substitute.For<IEntityRepository<PersonEntity>>(), TimeProvider.System);

        await Assert.ThrowsAsync<ArgumentException>(
            () => service.CreateWithIdAsync(householdId, "House", "org-object-id", null, CancellationToken.None));
        Assert.Empty(households.ReceivedCalls());
    }

    [Fact]
    public async Task CreateAsync_still_generates_an_id()
    {
        var households = Substitute.For<IHouseholdRepository>();
        var people = Substitute.For<IEntityRepository<PersonEntity>>();
        var ids = new List<string>();
        households
            .When(r => r.AddAsync(Arg.Any<HouseholdEntity>(), Arg.Any<CancellationToken>()))
            .Do(ci => ids.Add(ci.Arg<HouseholdEntity>().RowKey));
        households
            .GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(ci => new HouseholdEntity { RowKey = ci.Arg<string>() });

        var service = new HouseholdService(households, people, TimeProvider.System);

        var first = await service.CreateAsync("House", "org-object-id", null, CancellationToken.None);
        var second = await service.CreateAsync("House", "org-object-id", null, CancellationToken.None);

        Assert.Equal(2, ids.Count);
        Assert.All(ids, id => Assert.Equal(32, id.Length));
        Assert.NotEqual(first.HouseholdId, second.HouseholdId);
        Assert.Equal(ids, [first.HouseholdId, second.HouseholdId]);
    }

    [Fact]
    public async Task GetAsync_returns_null_when_the_household_does_not_exist()
    {
        var households = Substitute.For<IHouseholdRepository>();
        var people = Substitute.For<IEntityRepository<PersonEntity>>();
        households
            .GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((HouseholdEntity?)null);

        var service = new HouseholdService(households, people, TimeProvider.System);

        Assert.Null(await service.GetAsync("unknown", CancellationToken.None));
    }
}
