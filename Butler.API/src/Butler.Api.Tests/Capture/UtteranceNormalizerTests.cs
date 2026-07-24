using Butler.Api.Application.Capture;

namespace Butler.Api.Tests.Capture;

/// <summary>
/// The documented v1 normalization (G3 risk mitigation: a simple, stated rule plus
/// suggestions on low confidence, rather than clever parsing). This is the table
/// that rule is held to - including the parts it deliberately does not do, such as
/// reading a quantity out of the sentence.
/// </summary>
public sealed class UtteranceNormalizerTests
{
    [Theory]
    // A leading "add" is stripped; the rest is the product term.
    [InlineData("add oat milk", "oat milk")]
    [InlineData("oat milk", "oat milk")]
    [InlineData("Add Eggs", "Eggs")]
    // Repeated fillers all go.
    [InlineData("please add some bananas", "bananas")]
    [InlineData("add a loaf", "loaf")]
    [InlineData("add an avocado", "avocado")]
    // Sentence punctuation is trimmed per word...
    [InlineData("add milk.", "milk")]
    [InlineData("Add rice!", "rice")]
    // ... but characters that carry meaning inside product names survive.
    [InlineData("add H-E-B 2% Reduced Fat Milk", "H-E-B 2% Reduced Fat Milk")]
    // One trailing destination phrase is dropped.
    [InlineData("add milk to the cart", "milk")]
    [InlineData("add eggs to my cart", "eggs")]
    [InlineData("add rice to the grocery list", "rice")]
    [InlineData("add bread to the shopping list", "bread")]
    [InlineData("add cheese to the list", "cheese")]
    // Whitespace is collapsed.
    [InlineData("  add   oat   milk  ", "oat milk")]
    // Nothing product-shaped left.
    [InlineData(null, "")]
    [InlineData("", "")]
    [InlineData("    ", "")]
    [InlineData("add", "")]
    [InlineData("please add some", "")]
    [InlineData("add to the cart", "")]
    // Quantities are not parsed out of the utterance in v1 - they ride on the
    // request instead - so the words stay in the search term.
    [InlineData("add two dozen eggs", "two dozen eggs")]
    public void ExtractProductTerm_follows_the_documented_rule(string? utterance, string expected)
    {
        Assert.Equal(expected, UtteranceNormalizer.ExtractProductTerm(utterance));
    }
}
