using Butler.Api.Infrastructure.Assignments;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.Assignments;

/// <summary>
/// Composition entry point for the Assignments feature (Engineering Contract 7.2).
/// Registers the <c>Assignments</c> and <c>ChoreCompletions</c> tables on the
/// shared F3 storage seam, their repositories, and the injected clock;
/// <c>Program.cs</c> wires it with a single <see cref="AddAssignmentsFeature"/>
/// call. This is the tested persistence + time base the assignment engine (C2) and
/// the endpoints (C3, C4) build on.
/// </summary>
public static class AssignmentsServiceCollectionExtensions
{
    /// <summary>Registers everything the Assignments feature needs.</summary>
    public static IServiceCollection AddAssignmentsFeature(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The tables this feature owns on the shared F3 seam (7.3).
        services.AddTableRepository<AssignmentEntity>("Assignments");
        services.AddTableRepository<ChoreCompletionEntity>("ChoreCompletions");

        services.TryAddSingleton<IAssignmentRepository, TableAssignmentRepository>();
        services.TryAddSingleton<IChoreCompletionRepository, TableChoreCompletionRepository>();

        // The v1 fair-assignment engine (C2, Contract 7.6): a pure, deterministic,
        // stateless function, so a singleton is safe. C3 injects it to place a
        // week's chores from data it fetched; the engine itself does no I/O.
        services.TryAddSingleton<IFairAssignmentEngine, FairAssignmentEngine>();

        // C3: the fetch -> compute -> persist composition that runs the engine over
        // the household's active chores and people and writes the week's
        // assignments. Scoped (like the other application services) since it
        // orchestrates per-request repository work.
        services.TryAddScoped<IAssignmentGenerationService, AssignmentGenerationService>();

        // Injected clock so weekIso/due/completion times stay deterministically
        // testable; no assignment code path reads DateTime.Now (7.5).
        services.TryAddSingleton(TimeProvider.System);

        return services;
    }
}
