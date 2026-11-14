using Butler.Api.Application.Insights;
using Butler.Api.Tests.Assignments;

namespace Butler.Api.Tests.Insights;

/// <summary>
/// Criterion (#123 AC11 / Engineering Contract 7.5): the insights window is
/// anchored to the injected clock, so no insights code path may read the ambient
/// system clock (<c>DateTime.Now</c> / <c>DateTime.UtcNow</c>). This reuses the IL
/// scanner that guards the assignment feature; its own red/green is proven next to
/// its definition in <see cref="DirectClockUsageGuardTests"/>.
/// </summary>
public sealed class InsightsClockGuardTests
{
    [Fact]
    public void No_insights_code_path_reads_the_ambient_clock()
    {
        var assembly = typeof(InsightsService).Assembly;

        var guardedTypes = assembly.GetTypes()
            .Where(type => string.Equals(type.Namespace, "Butler.Api.Application.Insights", StringComparison.Ordinal))
            .ToArray();

        // Guard the guard: an empty scan would pass vacuously if the namespace moved.
        Assert.NotEmpty(guardedTypes);

        var violations = guardedTypes
            .SelectMany(AmbientClockScanner.FindDirectClockReads)
            .ToArray();

        Assert.Empty(violations);
    }
}
