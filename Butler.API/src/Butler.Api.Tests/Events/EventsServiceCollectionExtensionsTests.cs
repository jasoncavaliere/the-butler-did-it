using Butler.Api.Application.Events;
using Butler.Api.Infrastructure.Events;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Butler.Api.Tests.Events;

/// <summary>
/// Criterion (#122 AC1): <c>AddEventsFeature()</c> registers the <c>Events</c>
/// table on the shared F3 seam (<c>AddTableRepository</c>), the append-only
/// repository, the recorder, and the injected clock.
/// </summary>
public sealed class EventsServiceCollectionExtensionsTests
{
    private static ServiceCollection BuildServices()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>())
            .Build();

        var services = new ServiceCollection();
        services.AddStorage(configuration);
        services.AddSingleton(typeof(ILogger<>), typeof(NullLogger<>));
        services.AddEventsFeature();
        return services;
    }

    [Fact]
    public void AddEventsFeature_registers_the_Events_table_repository_and_recorder()
    {
        using var provider = BuildServices().BuildServiceProvider();
        using var scope = provider.CreateScope();

        Assert.NotNull(provider.GetService<IEntityRepository<EventEntity>>());
        Assert.IsType<TableEventRepository>(provider.GetRequiredService<IEventRepository>());
        Assert.IsType<EventRecorder>(scope.ServiceProvider.GetRequiredService<IEventRecorder>());
        Assert.NotNull(provider.GetService<TimeProvider>());
    }

    [Fact]
    public void AddEventsFeature_rejects_a_null_service_collection()
    {
        Assert.Throws<ArgumentNullException>(
            () => EventsServiceCollectionExtensions.AddEventsFeature(null!));
    }
}
