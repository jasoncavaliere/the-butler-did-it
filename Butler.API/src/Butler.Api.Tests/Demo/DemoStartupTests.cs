using Butler.Api.Application.Demo;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.Hosting;
using Butler.Api.Infrastructure.People;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace Butler.Api.Tests.Demo;

/// <summary>
/// Criteria (#97 AC2, AC4): starting the API with <c>--seed-demo</c> (which
/// <see cref="DemoCommandLine.Normalize"/> rewrites to
/// <c>Demo:SeedOnStartup=true</c>) seeds the demo household before the app
/// serves; a plain boot seeds nothing; and outside Development and Demo the host
/// refuses to start.
/// </summary>
public sealed class DemoStartupTests
{
    private static WebApplicationFactory<Program> CreateFactory(string environment, bool seedOnStartup) =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            if (seedOnStartup)
            {
                builder.UseSetting(DemoCommandLine.SeedOnStartupKey, "true");
            }

            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton<TimeProvider>(new MutableClock(DemoTestHost.MidJuly));
            });
        });

    [Theory]
    [InlineData("Development")]
    [InlineData(ButlerEnvironments.Demo)]
    public async Task Seed_on_startup_setting_seeds_the_demo_household(string environment)
    {
        using var factory = CreateFactory(environment, seedOnStartup: true);
        using var client = factory.CreateClient();

        var household = Assert.Single(await DemoTestHost.RowsAsync<HouseholdEntity>(factory));
        Assert.Equal(DemoHousehold.Id, household.RowKey);
        Assert.Equal(5, (await DemoTestHost.RowsAsync<PersonEntity>(factory)).Count);

        // The app keeps serving after seeding.
        using var health = await client.GetAsync(new Uri("/health", UriKind.Relative));
        Assert.True(health.IsSuccessStatusCode);
    }

    [Fact]
    public async Task Default_boot_does_not_seed()
    {
        using var factory = CreateFactory(Environments.Development, seedOnStartup: false);
        using var client = factory.CreateClient();

        Assert.Empty(await DemoTestHost.RowsAsync<HouseholdEntity>(factory));
    }

    [Fact]
    public void Startup_with_seed_flag_outside_Development_or_Demo_fails_fast()
    {
        using var factory = CreateFactory(Environments.Production, seedOnStartup: true).WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Authentication:DisableAuthentication", "false");
            builder.UseSetting(
                "Authentication:Authority",
                "https://login.example.com/00000000-0000-0000-0000-000000000000/v2.0");
            builder.UseSetting("Authentication:Audience", "api://butler-test");
        });

        var exception = Record.Exception(() => factory.CreateClient());

        Assert.NotNull(exception);
        var refusal = Unwrap(exception).OfType<DemoSeedingNotAllowedException>().FirstOrDefault();
        Assert.NotNull(refusal);
        Assert.Contains("Production", refusal.Message, StringComparison.Ordinal);
    }

    // The deferred host may wrap the entry point's exception; walk the chain.
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
