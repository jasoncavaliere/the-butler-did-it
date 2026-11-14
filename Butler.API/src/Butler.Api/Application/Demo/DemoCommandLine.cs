using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.Hosting;
using Butler.Api.Infrastructure.Storage;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Butler.Api.Application.Demo;

/// <summary>
/// The <c>--seed-demo</c> start-up switch (#97). Running the API with
/// <c>--seed-demo</c> (or with <c>Demo__SeedOnStartup=true</c> in the
/// environment) seeds the demo household as the dev organizer just before the
/// app starts serving; the app then keeps running. Outside Development and Demo
/// the host refuses to start with an error naming <c>Demo:SeedOnStartup</c>
/// (#106), before any table is provisioned.
/// </summary>
public static partial class DemoCommandLine
{
    /// <summary>The bare command-line switch.</summary>
    public const string SeedDemoSwitch = "--seed-demo";

    /// <summary>The configuration key the switch is rewritten to.</summary>
    public const string SeedOnStartupKey = "Demo:SeedOnStartup";

    /// <summary>
    /// Rewrites a bare <see cref="SeedDemoSwitch"/> (any casing) to
    /// <c>--Demo:SeedOnStartup=true</c> and leaves every other argument as it is.
    /// Call it before <c>WebApplication.CreateBuilder</c>: the command-line
    /// configuration provider reads a bare <c>--key</c> as taking the next
    /// argument as its value, so <c>--seed-demo --urls X</c> would otherwise
    /// swallow <c>--urls</c>.
    /// </summary>
    /// <param name="args">The process arguments.</param>
    /// <returns>A new array with the switch rewritten.</returns>
    public static string[] Normalize(string[] args)
    {
        ArgumentNullException.ThrowIfNull(args);

        return args
            .Select(arg => string.Equals(arg, SeedDemoSwitch, StringComparison.OrdinalIgnoreCase)
                ? $"--{SeedOnStartupKey}=true"
                : arg)
            .ToArray();
    }

    /// <summary>
    /// Seeds the demo household when <see cref="SeedOnStartupKey"/> is
    /// <c>true</c>, as the dev organizer, and logs the household id. Does
    /// nothing otherwise. This runs before <c>app.Run()</c> starts the hosted
    /// services, so it provisions the registered tables itself first (#91); the
    /// hosted service's later run is an idempotent no-op. Outside Development and
    /// Demo it throws <see cref="DemoSeedingNotAllowedException"/> (naming
    /// <see cref="SeedOnStartupKey"/>) before provisioning anything, which stops
    /// the host from starting (#106).
    /// </summary>
    /// <param name="app">The built application.</param>
    public static async Task SeedDemoIfRequestedAsync(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        if (!app.Configuration.GetValue<bool>(SeedOnStartupKey))
        {
            return;
        }

        // Fail closed before any I/O: a non-demo host must not even provision tables.
        if (!app.Environment.IsDevelopmentOrDemo())
        {
            throw DemoSeedingNotAllowedException.ForSeedOnStartup(app.Environment.EnvironmentName);
        }

        await app.Services.GetRequiredService<TableProvisioner>().ProvisionAsync().ConfigureAwait(false);

        var scope = app.Services.CreateAsyncScope();
        await using (scope.ConfigureAwait(false))
        {
            var seeder = scope.ServiceProvider.GetRequiredService<IDemoSeeder>();
            var result = await seeder
                .SeedAsync(OrganizerAuthorization.DevOrganizerSubject, OrganizerAuthorization.DevOrganizerName)
                .ConfigureAwait(false);

            var logger = app.Services
                .GetRequiredService<ILoggerFactory>()
                .CreateLogger(typeof(DemoCommandLine).FullName!);
            LogSeeded(logger, result.HouseholdId, result.CurrentWeekIso);
        }
    }

    [LoggerMessage(
        EventId = 9701,
        Level = LogLevel.Information,
        Message = "Seeded demo household {HouseholdId} for week {WeekIso}")]
    private static partial void LogSeeded(ILogger logger, string householdId, string weekIso);
}
