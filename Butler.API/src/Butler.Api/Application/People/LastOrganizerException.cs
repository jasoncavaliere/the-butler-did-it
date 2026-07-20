namespace Butler.Api.Application.People;

/// <summary>
/// Raised when a roster mutation would leave a household with no organizer:
/// demoting the sole remaining organizer to a participant, or deleting them. A
/// household must always retain at least one organizer so someone can perform
/// sensitive actions (issue #12 / Engineering Contract 7.4). Mapped to HTTP
/// <c>400 Bad Request</c> (RFC 7807 problem details) by
/// <c>Mediation/ApiExceptionHandler</c>; the person's row is left unchanged.
/// </summary>
public sealed class LastOrganizerException : Exception
{
    private const string DefaultMessage =
        "A household must retain at least one organizer; the last organizer cannot be demoted or removed.";

    public LastOrganizerException()
        : base(DefaultMessage)
    {
    }

    public LastOrganizerException(string message)
        : base(message)
    {
    }

    public LastOrganizerException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
