using Butler.Api.Application.Carts;

namespace Butler.Api.Tests.Carts;

/// <summary>
/// <see cref="CartAlreadyConfirmedException"/> carries the standard exception
/// constructors (CA1032) so it behaves like any other exception at call sites.
/// These cases exercise each constructor's message / inner-exception behaviour.
/// </summary>
public sealed class CartAlreadyConfirmedExceptionTests
{
    [Fact]
    public void Default_message_is_populated()
    {
        var exception = new CartAlreadyConfirmedException();

        Assert.False(string.IsNullOrWhiteSpace(exception.Message));
    }

    [Fact]
    public void Carries_message_and_inner()
    {
        var inner = new InvalidOperationException("inner");
        Assert.Equal("custom", new CartAlreadyConfirmedException("custom").Message);

        var withInner = new CartAlreadyConfirmedException("custom", inner);
        Assert.Equal("custom", withInner.Message);
        Assert.Same(inner, withInner.InnerException);
    }
}
