using System.Reflection;
using System.Reflection.Emit;
using Butler.Api.Domain.Scheduling;

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
/// Minimal IL reader that reports methods which call the <c>DateTime.Now</c> or
/// <c>DateTime.UtcNow</c> property getters directly. It walks the method body byte
/// stream opcode-by-opcode (using the operand-size rules of ECMA-335) and resolves
/// the metadata token behind every <c>InlineMethod</c> operand.
/// </summary>
internal static class AmbientClockScanner
{
    private static readonly OpCode?[] OneByteOpCodes = new OpCode?[256];
    private static readonly OpCode?[] TwoByteOpCodes = new OpCode?[256];

    static AmbientClockScanner()
    {
        foreach (var field in typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static))
        {
            if (field.GetValue(null) is not OpCode op)
            {
                continue;
            }

            var index = op.Value & 0xFF;
            if (op.Size == 2)
            {
                TwoByteOpCodes[index] = op;
            }
            else
            {
                OneByteOpCodes[index] = op;
            }
        }
    }

    internal static IEnumerable<string> FindDirectClockReads(Type type)
    {
        ArgumentNullException.ThrowIfNull(type);

        const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic
            | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

        var methods = type.GetMethods(flags).Cast<MethodBase>()
            .Concat(type.GetConstructors(flags));

        foreach (var method in methods)
        {
            var body = method.GetMethodBody();
            var il = body?.GetILAsByteArray();
            if (il is null)
            {
                continue;
            }

            foreach (var violation in Scan(method, il))
            {
                yield return violation;
            }
        }
    }

    private static IEnumerable<string> Scan(MethodBase method, byte[] il)
    {
        var module = method.Module;
        var typeArgs = method.DeclaringType is { IsGenericType: true } dt
            ? dt.GetGenericArguments()
            : null;
        var methodArgs = method is MethodInfo { IsGenericMethodDefinition: true } mi
            ? mi.GetGenericArguments()
            : null;

        var position = 0;
        while (position < il.Length)
        {
            OpCode? current;
            if (il[position] == 0xFE && position + 1 < il.Length)
            {
                current = TwoByteOpCodes[il[position + 1]];
                position += 2;
            }
            else
            {
                current = OneByteOpCodes[il[position]];
                position += 1;
            }

            if (current is not { } opCode)
            {
                // Unrecognized opcode: stop scanning this method rather than risk
                // misreading a token from the middle of an operand.
                yield break;
            }

            if (opCode.OperandType == OperandType.InlineMethod && position + 4 <= il.Length)
            {
                var token = BitConverter.ToInt32(il, position);
                var resolved = TryResolveMethod(module, token, typeArgs, methodArgs);
                if (IsAmbientClockGetter(resolved))
                {
                    yield return
                        $"{method.DeclaringType?.FullName}.{method.Name} -> System.DateTime.{resolved!.Name}";
                }
            }

            position += OperandSize(opCode, il, position);
        }
    }

    private static bool IsAmbientClockGetter(MethodBase? method) =>
        method is not null
        && method.DeclaringType == typeof(DateTime)
        && method.Name is "get_Now" or "get_UtcNow";

    private static MethodBase? TryResolveMethod(Module module, int token, Type[]? typeArgs, Type[]? methodArgs)
    {
        try
        {
            return module.ResolveMethod(token, typeArgs, methodArgs);
        }
        catch (ArgumentException)
        {
            // Not every InlineMethod token resolves to a MethodBase we can inspect
            // (e.g. vararg call sites); such tokens are never the clock getters.
            return null;
        }
    }

    private static int OperandSize(OpCode opCode, byte[] il, int position) => opCode.OperandType switch
    {
        OperandType.InlineNone => 0,
        OperandType.ShortInlineBrTarget
            or OperandType.ShortInlineI
            or OperandType.ShortInlineVar => 1,
        OperandType.InlineVar => 2,
        OperandType.InlineBrTarget
            or OperandType.InlineField
            or OperandType.InlineI
            or OperandType.InlineMethod
            or OperandType.InlineSig
            or OperandType.InlineString
            or OperandType.InlineTok
            or OperandType.InlineType
            or OperandType.ShortInlineR => 4,
        OperandType.InlineI8
            or OperandType.InlineR => 8,
        // A switch is a 4-byte count followed by that many 4-byte jump offsets.
        OperandType.InlineSwitch => 4 + (4 * BitConverter.ToInt32(il, position)),
        _ => 0,
    };
}
