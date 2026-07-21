using System.Reflection;
using System.Reflection.Emit;
using System.Security.Cryptography;
using Butler.Api.Application.Assignments;
using Butler.Api.Infrastructure.Assignments;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Enforces the purity/determinism criterion of Engineering Contract 7.6: the
/// fair-assignment engine must be a pure function of its in-memory input. It may
/// not read the ambient clock, use any randomness, or touch storage - if it did,
/// two runs on the same input could diverge and the "identical assignment set"
/// guarantee would break.
///
/// <para>
/// The guard decompiles the compiled IL of every method on the engine type (and
/// its compiler-generated nested types, e.g. the sort comparator) and flags any
/// <c>call</c>/<c>callvirt</c> to a clock getter, an RNG member, or a
/// storage/Azure type. Scanning IL - not source text - asserts what actually
/// ships, immune to comments, aliases, and formatting.
/// </para>
///
/// <para>
/// Red/green is proven in-suite: <see cref="Scanner_flags_clock_rng_and_storage_use"/>
/// runs the same scanner against a deliberately impure canary and proves it
/// reports all three categories (red), while
/// <see cref="The_engine_reads_no_clock_uses_no_rng_and_touches_no_storage"/>
/// proves the shipped engine is clean (green). A regression to any impurity would
/// turn the green test red.
/// </para>
/// </summary>
public sealed class FairAssignmentEnginePurityTests
{
    [Fact]
    public void The_engine_reads_no_clock_uses_no_rng_and_touches_no_storage()
    {
        var violations = PurityScanner.FindImpurities(typeof(FairAssignmentEngine)).ToArray();

        Assert.Empty(violations);
    }

    [Fact]
    public void Scanner_flags_clock_rng_and_storage_use()
    {
        // Positive control (the "red" half): the same scanner, run against code
        // that DOES read the clock, use RNG, and reference storage, must report
        // each category - otherwise the green assertion above is toothless.
        var violations = PurityScanner.FindImpurities(typeof(ImpureCanary)).ToArray();

        Assert.Contains(violations, v => v.StartsWith("clock:", StringComparison.Ordinal));
        Assert.Contains(violations, v => v.StartsWith("rng:", StringComparison.Ordinal));
        Assert.Contains(violations, v => v.StartsWith("storage:", StringComparison.Ordinal));
    }

    /// <summary>
    /// A deliberately impure type used only to prove the scanner is red on real
    /// violations. It never ships in <c>Butler.Api</c> and lives in the test
    /// assembly (excluded from the coverage gate). The members are never invoked;
    /// only their compiled IL is inspected.
    /// </summary>
    private static class ImpureCanary
    {
        public static long ReadsClock() => DateTime.UtcNow.Ticks + DateTimeOffset.Now.Ticks;

        public static int UsesRng() => new Random().Next() + RandomNumberGenerator.GetInt32(10) + Guid.NewGuid().GetHashCode();

        public static string TouchesStorage() => new AssignmentEntity().PartitionKey;
    }
}

/// <summary>
/// A minimal IL reader that reports methods calling a clock getter, an RNG member,
/// or a storage/Azure type - the impurities forbidden by Engineering Contract 7.6.
/// It walks the method body byte stream opcode-by-opcode (ECMA-335 operand sizing),
/// resolves the metadata token behind every <c>InlineMethod</c> operand, and
/// classifies the called method's declaring type. It recurses into nested types so
/// compiler-generated lambda/closure methods are inspected too.
/// </summary>
internal static class PurityScanner
{
    private static readonly OpCode?[] OneByteOpCodes = new OpCode?[256];
    private static readonly OpCode?[] TwoByteOpCodes = new OpCode?[256];

    static PurityScanner()
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

    internal static IEnumerable<string> FindImpurities(Type type)
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

        // Recurse into nested types (compiler-generated closures, the sort
        // comparator's display class, PersonState, ...).
        foreach (var nested in type.GetNestedTypes(BindingFlags.Public | BindingFlags.NonPublic))
        {
            foreach (var violation in FindImpurities(nested))
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
                var category = Classify(resolved);
                if (category is not null)
                {
                    yield return
                        $"{category}: {method.DeclaringType?.FullName}.{method.Name} -> "
                        + $"{resolved!.DeclaringType?.FullName}.{resolved.Name}";
                }
            }

            position += OperandSize(opCode, il, position);
        }
    }

    // Returns the impurity category of a called method, or null when it is pure.
    private static string? Classify(MethodBase? method)
    {
        if (method?.DeclaringType is not { } declaringType)
        {
            return null;
        }

        if (declaringType == typeof(DateTime) || declaringType == typeof(DateTimeOffset))
        {
            if (method.Name is "get_Now" or "get_UtcNow" or "get_Today")
            {
                return "clock";
            }
        }

        if (declaringType == typeof(Random)
            || declaringType == typeof(RandomNumberGenerator)
            || (declaringType == typeof(Guid) && method.Name == nameof(Guid.NewGuid)))
        {
            return "rng";
        }

        var ns = declaringType.Namespace;
        if (ns is not null
            && (ns.StartsWith("Butler.Api.Infrastructure", StringComparison.Ordinal)
                || ns == "Azure"
                || ns.StartsWith("Azure.", StringComparison.Ordinal)))
        {
            return "storage";
        }

        return null;
    }

    private static MethodBase? TryResolveMethod(Module module, int token, Type[]? typeArgs, Type[]? methodArgs)
    {
        try
        {
            return module.ResolveMethod(token, typeArgs, methodArgs);
        }
        catch (ArgumentException)
        {
            // Not every InlineMethod token resolves to a MethodBase we can inspect
            // (e.g. vararg call sites); such tokens are never an impurity we flag.
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
