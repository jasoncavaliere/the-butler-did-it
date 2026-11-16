using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.Households;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.TestSupport;

/// <summary>
/// Seeds a household for endpoint tests that make organizer writes (#295): those
/// writes now <c>404</c> when the household does not exist. Seed through the same
/// factory the client comes from, since each factory has its own store.
/// </summary>
internal static class TestHouseholds
{
    /// <summary>
    /// Writes only a <c>Households</c> row (no organizer <c>People</c> row, unlike
    /// <c>POST /households</c>), so roster counts stay unchanged, and returns its id.
    /// </summary>
    /// <param name="services">The factory's service provider.</param>
    /// <param name="name">The household's display name.</param>
    internal static async Task<string> SeedAsync(IServiceProvider services, string name = "Home")
    {
        ArgumentNullException.ThrowIfNull(services);
        var householdId = Guid.NewGuid().ToString("N");
        await services.GetRequiredService<IHouseholdRepository>().AddAsync(new HouseholdEntity
        {
            RowKey = householdId,
            Name = name,
            OrganizerObjectId = OrganizerAuthorization.DevOrganizerSubject,
            CreatedUtc = DateTimeOffset.UnixEpoch,
        });
        return householdId;
    }
}
