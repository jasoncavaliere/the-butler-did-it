using Butler.Api.Application.Households;

namespace Butler.Api.Tests.Households;

/// <summary>
/// <see cref="HouseholdTeardownIncompleteException"/> carries the standard
/// exception constructors (CA1032) plus <see cref="HouseholdTeardownIncompleteException.ForHousehold"/>,
/// which names the household and keeps the inner failure out of the message the
/// API copies into the problem detail (#294).
/// </summary>
public sealed class HouseholdTeardownIncompleteExceptionTests
{
    [Fact]
    public void Default_message_is_populated()
    {
        var exception = new HouseholdTeardownIncompleteException();

        Assert.False(string.IsNullOrWhiteSpace(exception.Message));
        Assert.Equal(string.Empty, exception.HouseholdId);
    }

    [Fact]
    public void Carries_message_and_inner()
    {
        var inner = new InvalidOperationException("inner");
        Assert.Equal("custom", new HouseholdTeardownIncompleteException("custom").Message);

        var withInner = new HouseholdTeardownIncompleteException("custom", inner);
        Assert.Equal("custom", withInner.Message);
        Assert.Same(inner, withInner.InnerException);
    }

    [Fact]
    public void ForHousehold_names_the_household_and_hides_the_inner_message()
    {
        var inner = new InvalidOperationException("secret storage detail");

        var exception = HouseholdTeardownIncompleteException.ForHousehold("h1", inner);

        Assert.Equal("h1", exception.HouseholdId);
        Assert.Same(inner, exception.InnerException);
        Assert.Contains("'h1'", exception.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(inner.Message, exception.Message, StringComparison.Ordinal);
    }
}
