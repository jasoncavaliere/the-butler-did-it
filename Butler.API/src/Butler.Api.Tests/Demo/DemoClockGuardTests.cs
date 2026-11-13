using Butler.Api.Application.Demo;
using Butler.Api.Tests.Assignments;

namespace Butler.Api.Tests.Demo;

/// <summary>
/// Criterion (#97 AC6, Engineering Contract 7.5): no demo-seeder code path reads
/// the ambient clock; every seeded date comes from the injected
/// <see cref="TimeProvider"/>. Reuses the IL scanner the assignment guard proves
/// red on a real violation.
/// </summary>
public sealed class DemoClockGuardTests
{
    private static readonly string[] GuardedNamespaces =
    {
        "Butler.Api.Application.Demo",
        "Butler.Api.Infrastructure.Demo",
    };

    [Fact]
    public void Demo_code_never_reads_the_ambient_clock()
    {
        var guardedTypes = typeof(DemoSeeder).Assembly.GetTypes()
            .Where(t => t.Namespace is not null && GuardedNamespaces.Contains(t.Namespace))
            .ToArray();

        Assert.Contains(typeof(DemoSeeder), guardedTypes);

        Assert.Empty(guardedTypes.SelectMany(AmbientClockScanner.FindDirectClockReads));
    }
}
