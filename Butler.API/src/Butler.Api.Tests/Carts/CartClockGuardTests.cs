using Butler.Api.Application.Carts;
using Butler.Api.Tests.Assignments;

namespace Butler.Api.Tests.Carts;

/// <summary>
/// Criterion (G2 / Engineering Contract 7.5): <c>weekIso</c> is computed from an
/// injected clock or a supplied date, deterministically - so no cart code path may
/// read the ambient system clock (<c>DateTime.Now</c> / <c>DateTime.UtcNow</c>).
/// This reuses the IL scanner that guards the assignment feature: it decompiles
/// every method of every cart type and flags any call to the ambient-clock
/// getters, which a source grep would miss behind aliases. The scanner's own
/// red/green is proven next to its definition in
/// <see cref="DirectClockUsageGuardTests"/>.
/// </summary>
public sealed class CartClockGuardTests
{
    private static readonly string[] GuardedNamespaces =
    {
        "Butler.Api.Application.Carts",
        "Butler.Api.Infrastructure.Carts",
    };

    [Fact]
    public void No_cart_code_path_reads_the_ambient_clock()
    {
        var assembly = typeof(CartService).Assembly;

        var guardedTypes = assembly.GetTypes()
            .Where(type => type.Namespace is not null && GuardedNamespaces.Contains(type.Namespace))
            .ToArray();

        // Guard the guard: an empty scan would pass vacuously if the namespaces
        // ever moved, so require that the feature was actually inspected.
        Assert.NotEmpty(guardedTypes);

        var violations = guardedTypes
            .SelectMany(AmbientClockScanner.FindDirectClockReads)
            .ToArray();

        Assert.Empty(violations);
    }
}
