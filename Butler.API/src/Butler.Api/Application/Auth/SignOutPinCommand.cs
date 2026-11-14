using MediatR;

namespace Butler.Api.Application.Auth;

/// <summary>
/// Revokes a demo PIN organizer token (#105). Idempotent: an unknown or missing
/// token is a no-op, so sign-out always succeeds.
/// </summary>
/// <param name="Token">The organizer bearer token to revoke, when one was presented.</param>
public sealed record SignOutPinCommand(string? Token) : IRequest;

/// <summary>Handles <see cref="SignOutPinCommand"/> through the PIN session store.</summary>
public sealed class SignOutPinCommandHandler : IRequestHandler<SignOutPinCommand>
{
    private readonly IPinOrganizerSessions _sessions;

    public SignOutPinCommandHandler(IPinOrganizerSessions sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        _sessions = sessions;
    }

    public Task Handle(SignOutPinCommand request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!string.IsNullOrEmpty(request.Token))
        {
            _sessions.SignOut(request.Token);
        }

        return Task.CompletedTask;
    }
}
