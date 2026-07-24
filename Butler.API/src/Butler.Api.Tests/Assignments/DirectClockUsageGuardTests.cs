using System.Reflection;
using Butler.Api.Domain.Scheduling;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Enforces Engineering Contract 7.5 for the assignment/completion feature: no
/// code path in that feature may read the ambient system clock directly
/// (<c>DateTime.Now</c> / <c>DateTime.UtcNow</c>); time must arrive through the
/// injected <see cref="TimeProvider"/> seam so week-bucketing, due dates, and the
/// completions ledger stay deterministically testable.
///
/// <para>
/// The guard works by decompiling the compiled IL of every method on every type in
/// the feature's namespaces and flagging any <c>call</c>/<c>callvirt</c> to the
/// <c>DateTime.get_Now</c> or <c>DateTime.get_UtcNow</c> property getters. A source
/// grep would miss aliases and be fooled by comments/strings; scanning IL asserts
/// what actually ships.
/// </para>
///
/// <para>
/// Red/green is demonstrated in-suite: <see cref="Scanner_flags_a_direct_clock_read"/>
/// runs the exact same scanner against a deliberately non-compliant canary and
/// proves it reports a violation (red), while
/// <see cref="No_assignment_or_completion_code_path_reads_the_ambient_clock"/> proves
/// the shipped feature code is clean (green). If the feature ever regressed to a
/// direct <c>DateTime.UtcNow</c>, the green test would turn red.
/// </para>
/// </summary>
public sealed class DirectClockUsageGuardTests
{
    // The namespaces that make up the assignment/completion code path.
    private static readonly string[] GuardedNamespaces =
    {
        "Butler.Api.Domain.Scheduling",
        "Butler.Api.Infrastructure.Assignments",
        "Butler.Api.Infrastructure.ChoreCompletions",
        "Butler.Api.Application.Assignments",
    };

    [Fact]
    public void No_assignment_or_completion_code_path_reads_the_ambient_clock()
    {
        var assembly = typeof(WeekIso).Assembly;

        var guardedTypes = assembly.GetTypes()
            .Where(t => t.Namespace is not null && GuardedNamespaces.Contains(t.Namespace))
            .ToArray();

        // Guard the guard: if the namespaces were renamed to nothing, an empty
        // scan would pass vacuously. Require that we actually inspected the feature.
        Assert.NotEmpty(guardedTypes);

        var violations = guardedTypes
            .SelectMany(AmbientClockScanner.FindDirectClockReads)
            .ToArray();

        Assert.Empty(violations);
    }

    [Fact]
    public void Scanner_flags_a_direct_clock_read()
    {
        // Positive control (the "red" half of red/green): the same scanner, run
        // against code that DOES read the ambient clock directly, must report it -
        // both getters - otherwise the green assertion above is toothless.
        var violations = AmbientClockScanner.FindDirectClockReads(typeof(AmbientClockCanary)).ToArray();

        Assert.Contains(violations, v => v.Contains("get_Now", StringComparison.Ordinal));
        Assert.Contains(violations, v => v.Contains("get_UtcNow", StringComparison.Ordinal));
    }

    /// <summary>
    /// A deliberately non-compliant type used only to prove the IL scanner is red on
    /// a real violation. It never ships in <c>Butler.Api</c> and lives in the test
    /// assembly (excluded from the coverage gate).
    /// </summary>
    private static class AmbientClockCanary
    {
        public static DateTime ReadsLocalClock() => DateTime.Now;

        public static DateTime ReadsUtcClock() => DateTime.UtcNow;
    }
}

/// <summary>
/// Reports methods that call the <c>DateTime.Now</c> or <c>DateTime.UtcNow</c>
/// property getters directly. The IL walking itself lives in the shared
/// <see cref="IlCallScanner"/>, which the other architecture guards (for example
/// the cart confirm path's no-external-call guard) reuse with their own predicate;
/// this type is just the ambient-clock predicate plus its reported message.
/// </summary>
internal static class AmbientClockScanner
{
    internal static IEnumerable<string> FindDirectClockReads(Type type) =>
        IlCallScanner.FindCalledMethods(type)
            .Where(call => IsAmbientClockGetter(call.Called))
            .Select(call =>
                $"{call.Caller.DeclaringType?.FullName}.{call.Caller.Name} -> System.DateTime.{call.Called.Name}");

    private static bool IsAmbientClockGetter(MethodBase method) =>
        method.DeclaringType == typeof(DateTime)
        && method.Name is "get_Now" or "get_UtcNow";
}
