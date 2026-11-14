using System.Globalization;

namespace Butler.Api.Application.Carts;

/// <summary>
/// Estimates a cart's total from the indicative prices persisted on its lines.
/// It lives with the carts (not the grocery connector) on purpose: the cart read
/// and confirm path must never reach the store connector (BRD decision D-8), so
/// the price is parsed from what the capture recorded rather than looked up.
/// </summary>
public static class CartPricing
{
    /// <summary>
    /// Parses an indicative price such as <c>$3.79</c> or <c>3.79</c>. Returns
    /// <c>false</c> for a blank or unparseable value.
    /// </summary>
    /// <param name="indicativePrice">The price as the connector reported it.</param>
    /// <param name="price">The parsed unit price, or <c>0</c> when parsing failed.</param>
    public static bool TryParseIndicativePrice(string? indicativePrice, out decimal price)
    {
        price = 0m;
        if (string.IsNullOrWhiteSpace(indicativePrice))
        {
            return false;
        }

        var text = indicativePrice.Trim();
        if (text.StartsWith('$'))
        {
            text = text[1..];
        }

        return decimal.TryParse(text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out price);
    }

    /// <summary>
    /// Sums quantity times the parsed indicative price over the catalog lines.
    /// Custom lines are not priced, and a line with no parseable price (for
    /// example one written before prices were recorded) adds nothing.
    /// </summary>
    /// <param name="items">The cart's lines.</param>
    public static decimal EstimatedTotal(IEnumerable<CartItemView> items)
    {
        ArgumentNullException.ThrowIfNull(items);

        var total = 0m;
        foreach (var item in items)
        {
            if (!item.IsCustom && TryParseIndicativePrice(item.IndicativePrice, out var price))
            {
                total += item.Quantity * price;
            }
        }

        return total;
    }
}
