using MediatR;

namespace Butler.Api.Application.Demo;

/// <summary>
/// Seeds (or re-seeds) the demo household on behalf of the calling organizer.
/// The organizer's object id and display name come from the authenticated
/// principal (resolved by the controller) so the handler stays free of the HTTP
/// context.
/// </summary>
/// <param name="OrganizerObjectId">Object id of the calling organizer.</param>
/// <param name="OrganizerDisplayName">The organizer's display name, when present.</param>
public sealed record SeedDemoHouseholdCommand(
    string OrganizerObjectId,
    string? OrganizerDisplayName) : IRequest<DemoSeedResponse>;

/// <summary>Handles <see cref="SeedDemoHouseholdCommand"/> via the demo seeder.</summary>
public sealed class SeedDemoHouseholdCommandHandler : IRequestHandler<SeedDemoHouseholdCommand, DemoSeedResponse>
{
    private readonly IDemoSeeder _seeder;

    public SeedDemoHouseholdCommandHandler(IDemoSeeder seeder)
    {
        ArgumentNullException.ThrowIfNull(seeder);
        _seeder = seeder;
    }

    public Task<DemoSeedResponse> Handle(SeedDemoHouseholdCommand request, CancellationToken cancellationToken) =>
        _seeder.SeedAsync(request.OrganizerObjectId, request.OrganizerDisplayName, cancellationToken);
}
