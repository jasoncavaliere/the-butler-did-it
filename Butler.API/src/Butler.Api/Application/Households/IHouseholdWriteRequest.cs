namespace Butler.Api.Application.Households;

/// <summary>
/// Marks an organizer create or update whose household must exist (#295). The
/// <c>HouseholdExistsBehavior</c> MediatR pipeline behavior reads the household
/// before the handler runs and throws <see cref="HouseholdNotFoundException"/>
/// (mapped to <c>404</c>) when it is missing, so no row is written for a household
/// that was torn down or never existed.
/// </summary>
public interface IHouseholdWriteRequest
{
    /// <summary>The household the write targets.</summary>
    string HouseholdId { get; }
}
