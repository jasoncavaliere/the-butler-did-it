using Butler.Api.Application.Households;

namespace Butler.Api.Tests.Households;

/// <summary>
/// <see cref="HouseholdNotFoundException"/> carries the standard exception
/// constructors (CA1032) plus <see cref="HouseholdNotFoundException.ForHousehold"/>,
/// which names the missing household (#295).
/// </summary>
public sealed class HouseholdNotFoundExceptionTests
{
    [Fact]
    public void Default_message_is_populated()
    {
        var exception = new HouseholdNotFoundException();

        Assert.Equal("The household does not exist.", exception.Message);
        Assert.Equal(string.Empty, exception.HouseholdId);
    }

    [Fact]
    public void Carries_message_and_inner()
    {
        var inner = new InvalidOperationException("inner");
        Assert.Equal("custom", new HouseholdNotFoundException("custom").Message);

        var withInner = new HouseholdNotFoundException("custom", inner);
        Assert.Equal("custom", withInner.Message);
        Assert.Same(inner, withInner.InnerException);
        Assert.Equal(string.Empty, withInner.HouseholdId);
    }

    [Fact]
    public void ForHousehold_sets_and_names_the_household()
    {
        var exception = HouseholdNotFoundException.ForHousehold("h1");

        Assert.Equal("h1", exception.HouseholdId);
        Assert.Equal("No household with id 'h1' exists.", exception.Message);
        Assert.Null(exception.InnerException);
    }
}
