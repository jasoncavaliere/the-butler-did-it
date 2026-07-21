using Butler.Api.Application.Assignments;
using Butler.Api.Infrastructure.Assignments;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Criterion: <c>AddAssignmentsFeature()</c> registers both repositories, the two
/// tables on the shared F3 seam, and the injected clock, so <c>Program.cs</c> wires
/// the whole feature with one call (Engineering Contract 7.2).
/// </summary>
public sealed class AssignmentsServiceCollectionExtensionsTests
{
    private static ServiceProvider BuildProvider()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>())
            .Build();

        var services = new ServiceCollection();
        services.AddStorage(configuration);
        services.AddAssignmentsFeature();
        return services.BuildServiceProvider();
    }

    [Fact]
    public void AddAssignmentsFeature_registers_the_assignment_repository()
    {
        using var provider = BuildProvider();

        Assert.IsType<TableAssignmentRepository>(provider.GetRequiredService<IAssignmentRepository>());
    }

    [Fact]
    public void AddAssignmentsFeature_registers_the_completion_repository()
    {
        using var provider = BuildProvider();

        Assert.IsType<TableChoreCompletionRepository>(provider.GetRequiredService<IChoreCompletionRepository>());
    }

    [Fact]
    public void AddAssignmentsFeature_registers_both_feature_tables()
    {
        using var provider = BuildProvider();

        Assert.NotNull(provider.GetService<IEntityRepository<AssignmentEntity>>());
        Assert.NotNull(provider.GetService<IEntityRepository<ChoreCompletionEntity>>());
    }

    [Fact]
    public void AddAssignmentsFeature_registers_the_injected_clock()
    {
        using var provider = BuildProvider();

        Assert.NotNull(provider.GetService<TimeProvider>());
    }

    [Fact]
    public void AddAssignmentsFeature_rejects_a_null_service_collection()
    {
        Assert.Throws<ArgumentNullException>(
            () => AssignmentsServiceCollectionExtensions.AddAssignmentsFeature(null!));
    }
}
