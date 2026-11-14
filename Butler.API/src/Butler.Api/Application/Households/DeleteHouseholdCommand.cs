using MediatR;

namespace Butler.Api.Application.Households;

/// <summary>
/// Tears a household down (#124): deletes every row it owns in every registered
/// table once <paramref name="ConfirmName"/> exactly matches its stored name.
/// </summary>
/// <param name="HouseholdId">The household to tear down.</param>
/// <param name="ConfirmName">The household name the organizer typed to confirm.</param>
public sealed record DeleteHouseholdCommand(string HouseholdId, string ConfirmName)
    : IRequest<HouseholdTeardownResult>;

/// <summary>Handles <see cref="DeleteHouseholdCommand"/> via the teardown service.</summary>
public sealed class DeleteHouseholdCommandHandler : IRequestHandler<DeleteHouseholdCommand, HouseholdTeardownResult>
{
    private readonly IHouseholdTeardownService _teardown;

    public DeleteHouseholdCommandHandler(IHouseholdTeardownService teardown)
    {
        ArgumentNullException.ThrowIfNull(teardown);
        _teardown = teardown;
    }

    public Task<HouseholdTeardownResult> Handle(DeleteHouseholdCommand request, CancellationToken cancellationToken) =>
        _teardown.TeardownAsync(request.HouseholdId, request.ConfirmName, cancellationToken);
}
