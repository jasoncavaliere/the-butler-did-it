using System.Reflection;
using Butler.Api.Application.Grocery;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Grocery;

/// <summary>
/// Search tests over the REAL embedded catalog (#114): a common synonym returns
/// the intended product (AC7), at least twenty common demo phrases each return
/// exactly their expected product (AC9), and catalog load plus search make no
/// network call and return identical results across independent loads (AC10,
/// BRD decision D-4). The anchor-phrase guards pin the phrases the capture,
/// cart, and demo integration tests rely on, so growing the catalog can never
/// quietly make one of them ambiguous.
/// </summary>
/// <remarks>
/// The no-network guard scans the shipped IL of every type in the grocery
/// namespace (nested compiler-generated types included) for calls into
/// <c>System.Net.*</c>. <see cref="Scanner_flags_a_network_call"/> runs the same
/// predicate against a deliberately non-compliant canary so the green assertion
/// is not toothless.
/// </remarks>
public sealed class HebCatalogSearchTests
{
    // Every AC9 demo phrase, in the same order as the theory rows below, so the
    // determinism test replays the full demo set against two independent loads.
    private static readonly string[] DemoPhrases =
    [
        "bananas", "avocados", "gala apples", "blueberries", "baby spinach",
        "russet potatoes", "broccoli crowns", "yellow onions",
        "oat milk", "eggs", "salted butter", "shredded cheese", "greek yogurt",
        "sour cream", "orange juice",
        "peanut butter", "bread", "rice", "black beans", "olive oil", "ground coffee",
        "tortilla chips",
        "vanilla ice cream", "french fries", "salmon", "chicken breast", "ground beef",
        "paper towels", "dish soap", "laundry detergent", "trash bags",
        "diapers", "baby wipes", "chicken nuggets", "juice boxes", "string cheese",
        "milk",
    ];

    private static readonly Lazy<SimulatedHebConnector> RealConnector =
        new(() => new SimulatedHebConnector(HebCatalog.Load()));

    [Theory]
    [InlineData("oatmilk", "heb-0017")]
    [InlineData("oj", "heb-0016")]
    [InlineData("hamburger meat", "heb-0008")]
    [InlineData("evoo", "heb-0110")]
    [InlineData("catsup", "heb-0121")]
    [InlineData("almondmilk", "heb-0062")]
    [InlineData("frijoles", "heb-0091")]
    [InlineData("garbanzo", "heb-0093")]
    [InlineData("yams", "heb-0051")]
    [InlineData("tin foil", "heb-0169")]
    [InlineData("toilet paper", "heb-0161")]
    [InlineData("garbage bags", "heb-0167")]
    [InlineData("kitty litter", "heb-0183")]
    [InlineData("nappies", "heb-0185")]
    public async Task A_synonym_returns_the_intended_product(string synonym, string expectedProductId)
    {
        var connector = RealConnector.Value;
        var expected = await connector.GetProductAsync(expectedProductId, CancellationToken.None);
        Assert.NotNull(expected);

        // The row proves synonym matching only if the phrase is not already in
        // the product's display name.
        Assert.DoesNotContain(synonym, expected.DisplayName, StringComparison.OrdinalIgnoreCase);

        var results = await connector.SearchProductsAsync(synonym, CancellationToken.None);

        var match = Assert.Single(results);
        Assert.Equal(expectedProductId, match.ProductId);
    }

    [Theory]
    // produce
    [InlineData("bananas", "heb-0005")]
    [InlineData("avocados", "heb-0006")]
    [InlineData("gala apples", "heb-0018")]
    [InlineData("blueberries", "heb-0021")]
    [InlineData("baby spinach", "heb-0041")]
    [InlineData("russet potatoes", "heb-0050")]
    [InlineData("broccoli crowns", "heb-0039")]
    [InlineData("yellow onions", "heb-0047")]
    // dairy
    [InlineData("oat milk", "heb-0017")]
    [InlineData("eggs", "heb-0003")]
    [InlineData("salted butter", "heb-0068")]
    [InlineData("shredded cheese", "heb-0074")]
    [InlineData("greek yogurt", "heb-0081")]
    [InlineData("sour cream", "heb-0072")]
    [InlineData("orange juice", "heb-0016")]
    // pantry
    [InlineData("peanut butter", "heb-0010")]
    [InlineData("bread", "heb-0004")]
    [InlineData("rice", "heb-0013")]
    [InlineData("black beans", "heb-0014")]
    [InlineData("olive oil", "heb-0110")]
    [InlineData("ground coffee", "heb-0119")]
    [InlineData("tortilla chips", "heb-0129")]
    // frozen
    [InlineData("vanilla ice cream", "heb-0143")]
    [InlineData("french fries", "heb-0149")]
    [InlineData("salmon", "heb-0152")]
    [InlineData("chicken breast", "heb-0007")]
    [InlineData("ground beef", "heb-0008")]
    // household
    [InlineData("paper towels", "heb-0160")]
    [InlineData("dish soap", "heb-0163")]
    [InlineData("laundry detergent", "heb-0165")]
    [InlineData("trash bags", "heb-0167")]
    // kids
    [InlineData("diapers", "heb-0185")]
    [InlineData("baby wipes", "heb-0186")]
    [InlineData("chicken nuggets", "heb-0191")]
    [InlineData("juice boxes", "heb-0200")]
    [InlineData("string cheese", "heb-0193")]
    public async Task A_common_demo_phrase_returns_its_expected_product(string phrase, string expectedProductId)
    {
        var results = await RealConnector.Value.SearchProductsAsync(phrase, CancellationToken.None);

        var match = Assert.Single(results);
        Assert.Equal(expectedProductId, match.ProductId);
    }

    [Fact]
    public void The_demo_phrase_set_covers_at_least_twenty_phrases()
    {
        // AC9's measure, stated directly: the demo set (less the deliberately
        // ambiguous "milk" control) is at least twenty phrases.
        Assert.True(DemoPhrases.Length - 1 >= 20, $"Only {DemoPhrases.Length - 1} demo phrases.");
    }

    [Fact]
    public void Catalog_load_and_search_make_no_network_calls()
    {
        var assembly = typeof(SimulatedHebConnector).Assembly;

        // Compiler-generated lambdas and state machines are nested types in the
        // same namespace, so scanning by namespace reaches where their calls live.
        var groceryTypes = assembly.GetTypes()
            .Where(type => string.Equals(type.Namespace, typeof(SimulatedHebConnector).Namespace, StringComparison.Ordinal))
            .ToArray();

        // Guard the guard: an empty scan would pass vacuously.
        Assert.NotEmpty(groceryTypes);
        Assert.Contains(typeof(HebCatalog), groceryTypes);
        Assert.Contains(typeof(SimulatedHebConnector), groceryTypes);

        var violations = groceryTypes.SelectMany(FindNetworkCalls).ToArray();

        Assert.Empty(violations);
    }

    [Fact]
    public void Scanner_flags_a_network_call()
    {
        // Positive control: the same predicate must report a real network call.
        var violations = FindNetworkCalls(typeof(NetworkCallCanary)).ToArray();

        Assert.Contains(violations, v => v.Contains("System.Net.Http", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Two_independent_loads_return_identical_search_results()
    {
        var first = new SimulatedHebConnector(HebCatalog.Load());
        var second = new SimulatedHebConnector(HebCatalog.Load());

        foreach (var phrase in DemoPhrases)
        {
            var a = await first.SearchProductsAsync(phrase, CancellationToken.None);
            var b = await second.SearchProductsAsync(phrase, CancellationToken.None);

            Assert.Equal(a, b);
        }
    }

    [Theory]
    [InlineData("oat milk", "heb-0017")]
    [InlineData("eggs", "heb-0003")]
    [InlineData("peanut butter", "heb-0010")]
    [InlineData("bread", "heb-0004")]
    [InlineData("rice", "heb-0013")]
    [InlineData("black beans", "heb-0014")]
    [InlineData("bananas", "heb-0005")]
    public async Task An_existing_capture_phrase_still_resolves_to_one_product(string phrase, string expectedProductId)
    {
        // These are the phrases the capture, cart, and PIN integration tests
        // auto-add against the real catalog: they must stay unambiguous.
        var results = await RealConnector.Value.SearchProductsAsync(phrase, CancellationToken.None);

        var match = Assert.Single(results);
        Assert.Equal(expectedProductId, match.ProductId);
    }

    [Fact]
    public async Task Milk_is_still_ambiguous()
    {
        var results = await RealConnector.Value.SearchProductsAsync("milk", CancellationToken.None);

        Assert.True(results.Count >= 2, $"Expected several milk candidates but got {results.Count}.");
    }

    [Theory]
    [InlineData("unicorn steaks")]
    [InlineData("caviar")]
    public async Task A_phrase_outside_the_catalog_matches_nothing(string phrase)
    {
        var results = await RealConnector.Value.SearchProductsAsync(phrase, CancellationToken.None);

        Assert.Empty(results);
    }

    [Theory]
    [InlineData("H-E-B Whole Milk", "heb-0001")]
    [InlineData("Fresh Bananas", "heb-0005")]
    [InlineData("H-E-B Spaghetti Pasta", "heb-0011")]
    [InlineData("H-E-B Marinara Pasta Sauce", "heb-0012")]
    [InlineData("H-E-B Grade A Large Eggs", "heb-0003")]
    [InlineData("H-E-B Oat Milk", "heb-0017")]
    public async Task A_demo_cart_display_name_is_an_exact_unique_hit(string displayName, string expectedProductId)
    {
        // The demo seeder adds products by exact display name; the name must match
        // exactly one product so the seeded cart cannot drift.
        var results = await RealConnector.Value.SearchProductsAsync(displayName, CancellationToken.None);

        var exact = Assert.Single(
            results,
            product => string.Equals(product.DisplayName, displayName, StringComparison.OrdinalIgnoreCase));
        Assert.Equal(expectedProductId, exact.ProductId);
        Assert.Single(results);
    }

    private static IEnumerable<string> FindNetworkCalls(Type type) =>
        IlCallScanner.FindCalledMethods(type)
            .Where(call => IsNetworkCall(call.Called))
            .Select(call =>
                $"{call.Caller.DeclaringType?.FullName}.{call.Caller.Name} -> " +
                $"{call.Called.DeclaringType?.FullName}.{call.Called.Name}");

    private static bool IsNetworkCall(MethodBase method) =>
        method.DeclaringType?.Namespace is { } declaringNamespace
        && declaringNamespace.StartsWith("System.Net", StringComparison.Ordinal);

    /// <summary>
    /// A deliberately non-compliant type used only to prove the scan is red on a
    /// real network call. It lives in the test assembly and never ships.
    /// </summary>
    private static class NetworkCallCanary
    {
        public static Task<string> FetchesTheCatalogOverHttp(HttpClient client) =>
            client.GetStringAsync(new Uri("https://store.example.com/catalog.json"));
    }
}
