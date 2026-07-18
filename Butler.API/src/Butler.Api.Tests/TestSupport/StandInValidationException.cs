namespace Butler.Api.Tests.TestSupport.StandIn;

/// <summary>
/// A stand-in for the validation library a later feature will ship (for example
/// FluentValidation): an exception whose <em>type name</em> is
/// <c>ValidationException</c> but which is deliberately NOT
/// <see cref="System.ComponentModel.DataAnnotations.ValidationException"/>.
/// It exists to exercise the fragile type-name match branch in
/// <c>ApiExceptionHandler.Classify</c> that maps such exceptions to <c>400</c>
/// without the API taking a compile-time dependency on that library.
/// </summary>
public sealed class ValidationException : Exception
{
    public ValidationException()
    {
    }

    public ValidationException(string message)
        : base(message)
    {
    }

    public ValidationException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
