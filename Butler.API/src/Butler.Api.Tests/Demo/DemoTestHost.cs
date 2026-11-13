using Azure.Data.Tables;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Demo;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Tests.Demo;

/// <summary>
/// Shared plumbing for the demo-seeder integration tests: a real app (in-memory
/// store, Development) with a controllable clock, plus helpers to seed through
/// the registered <see cref="IDemoSeeder"/> and read rows back from the
/// household's partitions. The demo id is fixed and the in-memory store is a
/// per-factory singleton, so every test builds its own factory.
/// </summary>
internal static class DemoTestHost
{
    /// <summary>A Wednesday in ISO week 2026-W29.</summary>
    public static readonly DateTimeOffset MidJuly = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);

    public static WebApplicationFactory<Program> CreateFactory(TimeProvider clock) =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton(clock);
            }));

    public static async Task<DemoSeedResponse> SeedAsync(WebApplicationFactory<Program> factory)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var seeder = scope.ServiceProvider.GetRequiredService<IDemoSeeder>();
        return await seeder.SeedAsync(
            OrganizerAuthorization.DevOrganizerSubject,
            OrganizerAuthorization.DevOrganizerName);
    }

    public static Task<IReadOnlyList<TEntity>> RowsAsync<TEntity>(WebApplicationFactory<Program> factory)
        where TEntity : class, ITableEntity, new() =>
        factory.Services
            .GetRequiredService<IEntityRepository<TEntity>>()
            .ListAsync(DemoHousehold.Id);
}
