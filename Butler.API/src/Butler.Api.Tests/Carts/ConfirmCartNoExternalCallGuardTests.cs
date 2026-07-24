using System.Reflection;
using Butler.Api.Application.Carts;
using Butler.Api.Application.Grocery;
using Butler.Api.Controllers;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Carts;

/// <summary>
/// Criterion (G4, BRD decision D-8): confirming a cart places no real order and
/// moves no money - it records intent only. The runtime proof that the store
/// connector is never invoked lives in
/// <see cref="ConfirmCartTests.Confirming_places_no_order_and_moves_no_money"/>;
/// this is the structural proof that no cart code path can reach a store, a
/// payment, or the network at all, whatever the call sequence.
/// </summary>
/// <remarks>
/// <para>
/// The guard decompiles the shipped IL of every method on every cart type (and the
/// controller that fronts them) and flags any call into the grocery connector
/// namespace or into <c>System.Net.*</c>. A source grep would miss aliases and be
/// fooled by comments and strings; scanning IL asserts what actually ships.
/// </para>
/// <para>
/// Red/green is demonstrated in-suite: <see cref="Scanner_flags_a_store_or_network_call"/>
/// runs the same predicate against a deliberately non-compliant canary and proves
/// it reports both a network call and a store call, so the green assertion in
/// <see cref="No_cart_code_path_calls_a_store_a_payment_or_the_network"/> is not
/// toothless.
/// </para>
/// </remarks>
public sealed class ConfirmCartNoExternalCallGuardTests
{
    // The confirm path: the cart application + persistence namespaces, whose types
    // are the only ones the confirm command touches.
    private static readonly string[] GuardedNamespaces =
    {
        "Butler.Api.Application.Carts",
        "Butler.Api.Infrastructure.Carts",
    };

    [Fact]
    public void No_cart_code_path_calls_a_store_a_payment_or_the_network()
    {
        var assembly = typeof(CartConfirmationService).Assembly;

        // Compiler-generated async state machines are nested types in the same
        // namespace, so scanning by namespace reaches where an async method's real
        // calls actually live - not just the stub that starts the state machine.
        var guardedTypes = assembly.GetTypes()
            .Where(type =>
                (type.Namespace is not null && GuardedNamespaces.Contains(type.Namespace))
                || IsCartsController(type))
            .ToArray();

        // Guard the guard: an empty scan would pass vacuously if the namespaces
        // ever moved, so require that the feature was actually inspected.
        Assert.NotEmpty(guardedTypes);

        var violations = guardedTypes.SelectMany(FindExternalCalls).ToArray();

        Assert.Empty(violations);
    }

    [Fact]
    public void Scanner_flags_a_store_or_network_call()
    {
        // Positive control (the "red" half of red/green): the same predicate, run
        // against code that DOES reach a store and the network, must report both.
        var violations = FindExternalCalls(typeof(ExternalCallCanary)).ToArray();

        Assert.Contains(violations, v => v.Contains("System.Net.Http", StringComparison.Ordinal));
        Assert.Contains(violations, v => v.Contains(nameof(IStoreConnector), StringComparison.Ordinal));
    }

    // The controller in front of the confirm route is part of the path, together
    // with its nested async state machines.
    private static bool IsCartsController(Type type) =>
        type.FullName is { } name
        && name.StartsWith(typeof(CartsController).FullName!, StringComparison.Ordinal);

    private static IEnumerable<string> FindExternalCalls(Type type) =>
        IlCallScanner.FindCalledMethods(type)
            .Where(call => IsExternalCall(call.Called))
            .Select(call =>
                $"{call.Caller.DeclaringType?.FullName}.{call.Caller.Name} -> " +
                $"{call.Called.DeclaringType?.FullName}.{call.Called.Name}");

    // What "external" means for the confirm path: the store connector (G1, and any
    // future real connector behind the same seam) and anything that opens a socket
    // or an HTTP request itself. There is no payment seam in Butler at all - D-8
    // means one is never introduced here, and this guard is what would catch it
    // arriving behind an HTTP client.
    private static bool IsExternalCall(MethodBase method)
    {
        var declaringNamespace = method.DeclaringType?.Namespace;
        if (declaringNamespace is null)
        {
            return false;
        }

        return string.Equals(declaringNamespace, typeof(IStoreConnector).Namespace, StringComparison.Ordinal)
            || declaringNamespace.StartsWith("System.Net", StringComparison.Ordinal);
    }

    /// <summary>
    /// A deliberately non-compliant type used only to prove the scan is red on a
    /// real violation. It never ships in <c>Butler.Api</c> and lives in the test
    /// assembly (excluded from the coverage gate).
    /// </summary>
    private static class ExternalCallCanary
    {
        public static Task<string> PlacesAnOrderOverHttp(HttpClient client) =>
            client.GetStringAsync(new Uri("https://store.example.com/place-order"));

        public static Task<IReadOnlyList<StoreProduct>> AsksTheStore(IStoreConnector store) =>
            store.SearchProductsAsync("oat milk");
    }
}
