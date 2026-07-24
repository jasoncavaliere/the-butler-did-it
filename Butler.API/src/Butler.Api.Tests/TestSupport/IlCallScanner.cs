using System.Reflection;
using System.Reflection.Emit;

namespace Butler.Api.Tests.TestSupport;

/// <summary>
/// Minimal IL reader that reports, for every method and constructor on a type,
/// which methods it actually calls. It walks each method body's byte stream
/// opcode-by-opcode (using the operand-size rules of ECMA-335) and resolves the
/// metadata token behind every <c>InlineMethod</c> operand.
/// </summary>
/// <remarks>
/// This is the shared engine behind the architecture guards that assert what a
/// feature may not do - reading the ambient clock (Engineering Contract 7.5), or
/// calling out to a store or the network on the cart confirm path (BRD decision
/// D-8). A source grep would miss aliases and be fooled by comments and strings;
/// scanning IL asserts what actually ships. Each guard supplies its own predicate
/// over the resolved call targets and proves its own red/green with a
/// deliberately non-compliant canary.
/// </remarks>
internal static class IlCallScanner
{
    private static readonly OpCode?[] OneByteOpCodes = new OpCode?[256];
    private static readonly OpCode?[] TwoByteOpCodes = new OpCode?[256];

    static IlCallScanner()
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

    /// <summary>
    /// Returns every resolvable call target in every method and constructor
    /// declared on <paramref name="type"/>, paired with the caller it was found in.
    /// </summary>
    internal static IEnumerable<(MethodBase Caller, MethodBase Called)> FindCalledMethods(Type type)
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

            foreach (var called in Scan(method, il))
            {
                yield return (method, called);
            }
        }
    }

    private static IEnumerable<MethodBase> Scan(MethodBase method, byte[] il)
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
                if (TryResolveMethod(module, token, typeArgs, methodArgs) is { } resolved)
                {
                    yield return resolved;
                }
            }

            position += OperandSize(opCode, il, position);
        }
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
            // (for example vararg call sites); such tokens are never a guarded call.
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
