namespace Butler.Api.Application.Capture;

/// <summary>
/// Turns an utterance into the product term the store connector searches for.
/// <para>
/// This is deliberately <b>not</b> natural-language understanding. v1 does one
/// documented, predictable pass and nothing clever, because the mitigation for a
/// mis-parse is to hand the shopper suggestions (see <see cref="CaptureOutcome.Ambiguous"/>)
/// rather than to guess harder:
/// </para>
/// <list type="number">
/// <item>split on whitespace and trim sentence punctuation (<c>. , ! ? ; :</c>)
/// off each word - so <c>"milk."</c> is <c>"milk"</c> while <c>"H-E-B"</c> and
/// <c>"2%"</c> survive intact;</item>
/// <item>drop leading filler words (<c>please</c>, <c>add</c>, <c>a</c>,
/// <c>an</c>, <c>some</c>) for as long as they keep appearing, so
/// <c>"please add some bananas"</c> is <c>"bananas"</c>;</item>
/// <item>drop one trailing "where to put it" phrase (<c>to the cart</c>,
/// <c>to my cart</c>, <c>to the list</c>, ...);</item>
/// <item>trim what is left.</item>
/// </list>
/// <para>
/// Quantities are never read out of the utterance ("add two dozen eggs" searches
/// for <c>"two dozen eggs"</c>); an explicit
/// <see cref="CaptureRequest.Quantity"/> is the supported way to add more than
/// one.
/// </para>
/// </summary>
internal static class UtteranceNormalizer
{
    // Sentence punctuation only. '-' and '%' are left alone on purpose: they are
    // load-bearing in product names ("H-E-B", "2% Reduced Fat Milk").
    private static readonly char[] SentencePunctuation = ['.', ',', '!', '?', ';', ':'];

    // Words that carry no product meaning at the front of a request.
    private static readonly string[] LeadingFillers = ["please", "add", "a", "an", "some"];

    // Trailing phrases that name the destination rather than the product. Ordered
    // longest-first so the most specific phrase wins.
    private static readonly string[] TrailingPhrases =
    [
        "to the grocery list",
        "to the shopping list",
        "to the cart",
        "to my cart",
        "to the list",
    ];

    /// <summary>
    /// Extracts the product term from <paramref name="utterance"/>, or returns an
    /// empty string when nothing product-shaped is left (the caller turns that
    /// into <see cref="CaptureOutcome.EmptyTerm"/>). Never throws.
    /// </summary>
    internal static string ExtractProductTerm(string? utterance)
    {
        if (string.IsNullOrWhiteSpace(utterance))
        {
            return string.Empty;
        }

        var words = utterance
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .Select(word => word.Trim(SentencePunctuation))
            .Where(word => word.Length > 0)
            .ToList();

        var first = 0;
        while (first < words.Count && LeadingFillers.Contains(words[first], StringComparer.OrdinalIgnoreCase))
        {
            first++;
        }

        var term = string.Join(' ', words.Skip(first));

        foreach (var phrase in TrailingPhrases)
        {
            if (term.EndsWith(phrase, StringComparison.OrdinalIgnoreCase))
            {
                term = term[..^phrase.Length];
                break;
            }
        }

        return term.Trim();
    }
}
