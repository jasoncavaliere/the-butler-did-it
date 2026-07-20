using MediatR;

namespace Butler.Api.Application.Households;

/// <summary>
/// Creates a new household owned by the calling organizer. The organizer's object
/// id and display name are resolved from the authenticated principal by the
/// controller (Engineering Contract 7.4) and carried on the command so the handler
/// stays free of the HTTP context.
/// </summary>
/// <param name="Name">The household's display name.</param>
/// <param name="OrganizerObjectId">Object id of the creating organizer.</param>
/// <param name="OrganizerDisplayName">The organizer's display name, when present.</param>
public sealed record CreateHouseholdCommand(
    string Name,
    string OrganizerObjectId,
    string? OrganizerDisplayName) : IRequest<HouseholdResponse>;

/// <summary>Handles <see cref="CreateHouseholdCommand"/> via the application service.</summary>
public sealed class CreateHouseholdCommandHandler : IRequestHandler<CreateHouseholdCommand, HouseholdResponse>
{
    private readonly IHouseholdService _households;

    public CreateHouseholdCommandHandler(IHouseholdService households)
    {
        ArgumentNullException.ThrowIfNull(households);
        _households = households;
    }

    public Task<HouseholdResponse> Handle(CreateHouseholdCommand request, CancellationToken cancellationToken) =>
        _households.CreateAsync(
            request.Name,
            request.OrganizerObjectId,
            request.OrganizerDisplayName,
            cancellationToken);
}
