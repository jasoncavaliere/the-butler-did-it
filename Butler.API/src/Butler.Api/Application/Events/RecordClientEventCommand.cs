using System.ComponentModel.DataAnnotations;
using Butler.Api.Infrastructure.Households;
using MediatR;

namespace Butler.Api.Application.Events;

/// <summary>
/// Records a client-posted usage event (#122). Only <see cref="EventTypes.HubGlanced"/>
/// is on the client allowlist; every other type is recorded server-side and is a
/// <c>400</c> here. The result is <c>false</c> for an unknown household (the
/// controller maps it to a <c>404</c>).
/// </summary>
/// <param name="HouseholdId">The household the event belongs to.</param>
/// <param name="Type">The posted event type.</param>
public sealed record RecordClientEventCommand(string HouseholdId, string? Type) : IRequest<bool>;

/// <summary>Handles <see cref="RecordClientEventCommand"/>.</summary>
public sealed class RecordClientEventCommandHandler : IRequestHandler<RecordClientEventCommand, bool>
{
    private readonly IEventRecorder _recorder;
    private readonly IHouseholdRepository _households;

    public RecordClientEventCommandHandler(IEventRecorder recorder, IHouseholdRepository households)
    {
        ArgumentNullException.ThrowIfNull(recorder);
        ArgumentNullException.ThrowIfNull(households);
        _recorder = recorder;
        _households = households;
    }

    public async Task<bool> Handle(RecordClientEventCommand request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // The allowlist is checked before any I/O: a client may never forge a
        // server-side event (participant-claimed, chore-completed, ...).
        if (!EventTypes.IsClientAllowed(request.Type))
        {
            throw new ValidationException(
                $"Event type '{request.Type}' may not be posted by a client.");
        }

        var household = await _households
            .GetAsync(request.HouseholdId, cancellationToken)
            .ConfigureAwait(false);
        if (household is null)
        {
            return false;
        }

        await _recorder
            .RecordAsync(request.HouseholdId, EventTypes.HubGlanced, cancellationToken: cancellationToken)
            .ConfigureAwait(false);
        return true;
    }
}
