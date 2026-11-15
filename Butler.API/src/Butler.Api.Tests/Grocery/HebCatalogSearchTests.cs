using System.Reflection;
using Butler.Api.Application.Grocery;
using Butler.Api.Tests.TestSupport;
using Xunit.Sdk;

namespace Butler.Api.Tests.Grocery;

/// <summary>
/// Search tests over the REAL embedded catalog (#114): a common synonym returns
/// the intended product (AC7), at least twenty common demo phrases each return
/// exactly their expected product (AC9; one shared <see cref="DemoPhraseRows"/>
/// table feeds both the per-phrase theory and the count, #203), and catalog load
/// plus search make no network call and return identical results across
/// independent loads (AC10, BRD decision D-4). The anchor-phrase guards pin the phrases the capture,
/// cart, and demo integration tests rely on, so growing the catalog can never
/// quietly make one of them ambiguous. The short-phrase collision anchors (#202)
/// pin that "pie" never resolves to diapers and "pb" auto-adds only peanut butter.
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
    // The ambiguous control phrase: it matches several products, so it is not a
    // demo row, but the determinism test still replays it.
    private const string AmbiguousControlPhrase = "milk";

    private static readonly Lazy<SimulatedHebConnector> RealConnector =
        new(() => new SimulatedHebConnector(HebCatalog.Load()));

    /// <summary>
    /// Every AC9 demo phrase with the product it must return. The per-phrase
    /// theory, the twenty-phrase count, and the determinism replay all read this
    /// one table, so a phrase cannot be counted without also being checked
    /// against its product id (#203).
    /// </summary>
    public static TheoryData<string, string> DemoPhraseRows { get; } = new()
    {
        // produce
        { "bananas", "heb-0005" },
        { "avocados", "heb-0006" },
        { "gala apples", "heb-0018" },
        { "blueberries", "heb-0021" },
        { "baby spinach", "heb-0041" },
        { "russet potatoes", "heb-0050" },
        { "broccoli crowns", "heb-0039" },
        { "yellow onions", "heb-0047" },
        // dairy
        { "oat milk", "heb-0017" },
        { "eggs", "heb-0003" },
        { "salted butter", "heb-0068" },
        { "shredded cheese", "heb-0074" },
        { "greek yogurt", "heb-0081" },
        { "sour cream", "heb-0072" },
        { "orange juice", "heb-0016" },
        // pantry
        { "peanut butter", "heb-0010" },
        { "bread", "heb-0004" },
        { "rice", "heb-0013" },
        { "black beans", "heb-0014" },
        { "olive oil", "heb-0110" },
        { "ground coffee", "heb-0119" },
        { "tortilla chips", "heb-0129" },
        // frozen
        { "vanilla ice cream", "heb-0143" },
        { "french fries", "heb-0149" },
        { "salmon", "heb-0152" },
        { "chicken breast", "heb-0007" },
        { "ground beef", "heb-0008" },
        // household
        { "paper towels", "heb-0160" },
        { "dish soap", "heb-0163" },
        { "laundry detergent", "heb-0165" },
        { "trash bags", "heb-0167" },
        // kids
        { "diapers", "heb-0185" },
        { "baby wipes", "heb-0186" },
        { "chicken nuggets", "heb-0191" },
        { "juice boxes", "heb-0200" },
        { "string cheese", "heb-0193" },
    };

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
    [InlineData("nappy", "heb-0185")]
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
    [MemberData(nameof(DemoPhraseRows))]
    public async Task A_common_demo_phrase_returns_its_expected_product(string phrase, string expectedProductId)
    {
        var results = await RealConnector.Value.SearchProductsAsync(phrase, CancellationToken.None);

        var match = Assert.Single(results);
        Assert.Equal(expectedProductId, match.ProductId);
    }

    [Fact]
    public void The_demo_phrase_set_covers_at_least_twenty_phrases()
    {
        // AC9's measure, stated directly over the same rows the theory checks:
        // at least twenty distinct phrases, each paired with its product id.
        AssertCoversAtLeastTwentyDistinctPhrases(DemoPhraseRows);
    }

    [Fact]
    public void The_count_check_fails_below_twenty_phrases()
    {
        // Negative control: nineteen real rows must fail the count check.
        var nineteen = new TheoryData<string, string>();
        foreach (var row in DemoPhraseRows.Take(19))
        {
            nineteen.Add((string)row[0], (string)row[1]);
        }

        Assert.ThrowsAny<XunitException>(() => AssertCoversAtLeastTwentyDistinctPhrases(nineteen));
    }

    [Fact]
    public void The_count_check_fails_when_a_duplicate_phrase_pads_the_count()
    {
        // Twenty rows, but only nineteen distinct phrases: a repeat must not count.
        var padded = new TheoryData<string, string>();
        foreach (var row in DemoPhraseRows.Take(19))
        {
            padded.Add((string)row[0], (string)row[1]);
        }

        var first = DemoPhraseRows.First();
        padded.Add(((string)first[0]).ToUpperInvariant(), (string)first[1]);

        Assert.ThrowsAny<XunitException>(() => AssertCoversAtLeastTwentyDistinctPhrases(padded));
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

        foreach (var phrase in DemoPhraseRows.Select(row => (string)row[0]).Append(AmbiguousControlPhrase))
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
        var results = await RealConnector.Value.SearchProductsAsync(AmbiguousControlPhrase, CancellationToken.None);

        Assert.True(results.Count >= 2, $"Expected several milk candidates but got {results.Count}.");
    }

    [Fact]
    public async Task Pie_does_not_resolve_to_diapers()
    {
        // #202: "pie" once matched the diapers synonym "nappies" by substring.
        // DoesNotContain, not Empty, so a future real pie product cannot break it.
        var results = await RealConnector.Value.SearchProductsAsync("pie", CancellationToken.None);

        Assert.DoesNotContain(results, product => product.ProductId == "heb-0185");
    }

    [Fact]
    public async Task Pb_resolves_to_peanut_butter_only()
    {
        // #202: "pb" once also matched "Fresh Raspberries" by substring, so it
        // came back ambiguous instead of auto-adding peanut butter.
        var results = await RealConnector.Value.SearchProductsAsync("pb", CancellationToken.None);

        var match = Assert.Single(results);
        Assert.Equal("heb-0010", match.ProductId);
        Assert.DoesNotContain(results, product => product.ProductId == "heb-0022");
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

    private static void AssertCoversAtLeastTwentyDistinctPhrases(TheoryData<string, string> rows)
    {
        var phrases = rows.Select(row => (string)row[0]).ToArray();

        Assert.Equal(rows.Count, phrases.Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.True(rows.Count >= 20, $"Only {rows.Count} demo phrases.");
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
