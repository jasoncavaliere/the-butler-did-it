using Butler.Api.Application.Concurrency;

namespace Butler.Api.Tests.Concurrency;

/// <summary>
/// The concurrency exceptions carry the standard exception constructors (CA1032)
/// so they behave like any other exception at call sites. These cases exercise
/// each constructor's message/inner-exception behaviour.
/// </summary>
public sealed class ConcurrencyExceptionTests
{
    [Fact]
    public void PreconditionRequired_default_message_is_populated()
    {
        var exception = new PreconditionRequiredException();
        Assert.False(string.IsNullOrWhiteSpace(exception.Message));
    }

    [Fact]
    public void PreconditionRequired_carries_message_and_inner()
    {
        var inner = new InvalidOperationException("inner");
        Assert.Equal("custom", new PreconditionRequiredException("custom").Message);

        var withInner = new PreconditionRequiredException("custom", inner);
        Assert.Equal("custom", withInner.Message);
        Assert.Same(inner, withInner.InnerException);
    }

    [Fact]
    public void PreconditionFailed_default_message_is_populated()
    {
        var exception = new PreconditionFailedException();
        Assert.False(string.IsNullOrWhiteSpace(exception.Message));
    }

    [Fact]
    public void PreconditionFailed_carries_message_and_inner()
    {
        var inner = new InvalidOperationException("inner");
        Assert.Equal("custom", new PreconditionFailedException("custom").Message);

        var withInner = new PreconditionFailedException("custom", inner);
        Assert.Equal("custom", withInner.Message);
        Assert.Same(inner, withInner.InnerException);
    }
}
