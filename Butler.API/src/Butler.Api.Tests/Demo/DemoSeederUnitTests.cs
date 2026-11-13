using Butler.Api.Application.Assignments;
using Butler.Api.Application.Capture;
using Butler.Api.Application.Chores;
using Butler.Api.Application.Demo;
using Butler.Api.Application.Households;
using Butler.Api.Application.People;
using Butler.Api.Application.Rooms;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Demo;
using Butler.Api.Infrastructure.Hosting;
using Butler.Api.Tests.TestSupport;
using Microsoft.Extensions.Hosting;
using NSubstitute;

namespace Butler.Api.Tests.Demo;

/// <summary>
/// Unit tests for <see cref="DemoSeeder"/> against NSubstitute fakes. They pin
/// the environment guard (#97 AC2: it refuses before any I/O outside Development
/// and Demo) and the loud failures the integration suite cannot reach: an
/// assignment generation that finds no household, and a cart item that does not
/// resolve to a single product.
/// </summary>
public sealed class DemoSeederUnitTests
{
    private readonly IHostEnvironment _environment = Substitute.For<IHostEnvironment>();
    private readonly IDemoHouseholdPurger _purger = Substitute.For<IDemoHouseholdPurger>();
    private readonly IHouseholdService _households = Substitute.For<IHouseholdService>();
    private readonly IRoomService _rooms = Substitute.For<IRoomService>();
    private readonly IPersonService _people = Substitute.For<IPersonService>();
    private readonly IChoreService _chores = Substitute.For<IChoreService>();
    private readonly IChoreCompletionRepository _completions = Substitute.For<IChoreCompletionRepository>();
    private readonly IAssignmentGenerationService _assignments = Substitute.For<IAssignmentGenerationService>();
    private readonly IChoreCompletionService _completionService = Substitute.For<IChoreCompletionService>();
    private readonly ICaptureHandler _capture = Substitute.For<ICaptureHandler>();

    public DemoSeederUnitTests()
    {
        _environment.EnvironmentName.Returns(Environments.Development);

        _rooms.CreateAsync(DemoHousehold.Id, Arg.Any<string>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(ci => new RoomResponse($"room-{ci.ArgAt<string>(1)}", ci.ArgAt<string>(1), ci.ArgAt<int>(2), "etag"));
        _people.CreateAsync(
                DemoHousehold.Id,
                Arg.Any<string>(),
                Arg.Any<string>(),
                Arg.Any<bool>(),
                Arg.Any<string?>(),
                Arg.Any<CancellationToken>())
            .Returns(ci => new PersonResponse(
                $"person-{ci.ArgAt<string>(1)}",
                ci.ArgAt<string>(1),
                ci.ArgAt<string>(2),
                ci.ArgAt<bool>(3),
                ci.ArgAt<string?>(4),
                "etag"));
        _chores.CreateAsync(
                DemoHousehold.Id,
                Arg.Any<string>(),
                Arg.Any<string>(),
                Arg.Any<string>(),
                Arg.Any<int>(),
                Arg.Any<int?>(),
                Arg.Any<CancellationToken>())
            .Returns(ci => new ChoreResponse(
                $"chore-{ci.ArgAt<string>(1)}",
                ci.ArgAt<string>(1),
                ci.ArgAt<string>(2),
                ci.ArgAt<string>(3),
                ci.ArgAt<int>(4),
                ci.ArgAt<int?>(5),
                true,
                "etag"));
    }

    private DemoSeeder CreateSeeder() => new(
        _environment,
        new MutableClock(DemoTestHost.MidJuly),
        _purger,
        _households,
        _rooms,
        _people,
        _chores,
        _completions,
        _assignments,
        _completionService,
        _capture);

    // Every chore assigned to Maria so the current-week lookups resolve.
    private static AssignmentSetResponse AllToMaria(string weekIso) => new(
        weekIso,
        DemoHousehold.Chores
            .Select(chore => new AssignmentView($"chore-{chore.Title}", "person-Maria", chore.Effort, "Open"))
            .ToList(),
        []);

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public async Task Seeder_refuses_outside_Development_and_Demo(string environmentName)
    {
        _environment.EnvironmentName.Returns(environmentName);

        var exception = await Assert.ThrowsAsync<DemoSeedingNotAllowedException>(
            () => CreateSeeder().SeedAsync("org", "Organizer"));

        Assert.Contains(environmentName, exception.Message, StringComparison.Ordinal);
        Assert.Empty(_purger.ReceivedCalls());
        Assert.Empty(_households.ReceivedCalls());
        Assert.Empty(_rooms.ReceivedCalls());
        Assert.Empty(_completions.ReceivedCalls());
    }

    [Theory]
    [InlineData("Development")]
    [InlineData(ButlerEnvironments.Demo)]
    public async Task Seeder_runs_in_Development_and_Demo(string environmentName)
    {
        _environment.EnvironmentName.Returns(environmentName);
        _assignments.GenerateAsync(DemoHousehold.Id, null, Arg.Any<CancellationToken>())
            .Returns(AllToMaria("2026-W29"));
        _capture.ResolveAndAddAsync(Arg.Any<string>(), Arg.Any<CaptureRequest>(), Arg.Any<CancellationToken>())
            .Returns(ci => CaptureResult.Added(
                CaptureSourceNames.HubText,
                ci.Arg<CaptureRequest>().Utterance,
                "2026-W29",
                new Application.Carts.CartItemView("item", "p", "d", 1, "person", "heb")));

        var result = await CreateSeeder().SeedAsync("org", "Organizer");

        Assert.Equal(DemoHousehold.Id, result.HouseholdId);
        await _purger.Received(1).PurgeAsync(DemoHousehold.Id, Arg.Any<CancellationToken>());
        await _households.Received(1).CreateWithIdAsync(
            DemoHousehold.Id, DemoHousehold.Name, "org", "Organizer", Arg.Any<CancellationToken>());
        await _completions.Received(45).AddAsync(
            DemoHousehold.Id, Arg.Any<ChoreCompletionEntity>(), Arg.Any<CancellationToken>());
        await _completionService.Received(3).CompleteAsync(
            DemoHousehold.Id, "2026-W29", Arg.Any<string>(), "person-Maria", Arg.Any<CancellationToken>());
        await _capture.Received(4).ResolveAndAddAsync(
            CaptureSourceNames.HubText,
            Arg.Is<CaptureRequest>(request => request.WeekIso == "2026-W29"),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Seed_fails_loudly_when_a_cart_item_does_not_resolve()
    {
        _assignments.GenerateAsync(DemoHousehold.Id, null, Arg.Any<CancellationToken>())
            .Returns(AllToMaria("2026-W29"));
        _capture.ResolveAndAddAsync(Arg.Any<string>(), Arg.Any<CaptureRequest>(), Arg.Any<CancellationToken>())
            .Returns(CaptureResult.NoMatch(CaptureSourceNames.HubText, "milk", "2026-W29"));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => CreateSeeder().SeedAsync("org", null));

        Assert.Contains("H-E-B Whole Milk", exception.Message, StringComparison.Ordinal);
        Assert.Contains(nameof(CaptureOutcome.NoMatch), exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Seed_fails_loudly_when_assignments_cannot_be_generated()
    {
        _assignments.GenerateAsync(DemoHousehold.Id, null, Arg.Any<CancellationToken>())
            .Returns((AssignmentSetResponse?)null);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => CreateSeeder().SeedAsync("org", null));

        Assert.IsNotType<DemoSeedingNotAllowedException>(exception);
        Assert.Contains(DemoHousehold.Id, exception.Message, StringComparison.Ordinal);
        Assert.Empty(_capture.ReceivedCalls());
    }

    [Fact]
    public void Not_allowed_exception_offers_the_standard_constructors()
    {
        var inner = new InvalidOperationException("inner");

        Assert.Contains("Development and Demo", new DemoSeedingNotAllowedException().Message, StringComparison.Ordinal);
        Assert.Equal("custom", new DemoSeedingNotAllowedException("custom").Message);
        Assert.Same(inner, new DemoSeedingNotAllowedException("wrapped", inner).InnerException);
        Assert.Contains("'Staging'", DemoSeedingNotAllowedException.ForEnvironment("Staging").Message, StringComparison.Ordinal);
    }
}
