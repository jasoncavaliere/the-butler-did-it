using MediatR;

namespace Butler.Api.Application.Auth;

/// <summary>
/// Signs the organizer in with the local demo PIN (#105). The controller maps
/// the outcome to <c>200</c>, a <c>401</c> problem (wrong PIN), or a <c>429</c>
/// problem (locked out); the handler stays free of the HTTP context.
/// </summary>
/// <param name="Pin">The submitted PIN.</param>
public sealed record SignInWithPinCommand(string Pin) : IRequest<PinSignInResult>;

/// <summary>Handles <see cref="SignInWithPinCommand"/> through the PIN session store.</summary>
public sealed class SignInWithPinCommandHandler : IRequestHandler<SignInWithPinCommand, PinSignInResult>
{
    private readonly IPinOrganizerSessions _sessions;

    public SignInWithPinCommandHandler(IPinOrganizerSessions sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        _sessions = sessions;
    }

    public Task<PinSignInResult> Handle(SignInWithPinCommand request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return Task.FromResult(_sessions.SignIn(request.Pin));
    }
}
