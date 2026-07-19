namespace Butler.Api.Application.Concurrency;

/// <summary>
/// Raised when a mutating operation is attempted without an <c>If-Match</c>
/// (ETag) precondition. Mutable content in Butler uses optimistic concurrency
/// (Engineering Contract 7.3): a caller must state which version it intends to
/// replace, so a missing precondition is a client error mapped to HTTP
/// <c>428 Precondition Required</c> by <c>Mediation/ApiExceptionHandler</c>.
/// </summary>
public sealed class PreconditionRequiredException : Exception
{
    private const string DefaultMessage =
        "An If-Match (ETag) header is required for this operation.";

    public PreconditionRequiredException()
        : base(DefaultMessage)
    {
    }

    public PreconditionRequiredException(string message)
        : base(message)
    {
    }

    public PreconditionRequiredException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

/// <summary>
/// Raised when a mutating operation carries an <c>If-Match</c> ETag that no
/// longer matches the stored entity: another writer changed it first. Mapped to
/// HTTP <c>412 Precondition Failed</c> by <c>Mediation/ApiExceptionHandler</c>
/// so the caller can re-read and retry.
/// </summary>
public sealed class PreconditionFailedException : Exception
{
    private const string DefaultMessage =
        "The resource was modified by another request; re-read and retry.";

    public PreconditionFailedException()
        : base(DefaultMessage)
    {
    }

    public PreconditionFailedException(string message)
        : base(message)
    {
    }

    public PreconditionFailedException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
