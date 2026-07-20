using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.People;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Households;

/// <summary>
/// Criteria (H1): <c>POST /households</c> creates the <c>Households</c> row with a
/// server-generated id and returns <c>201</c> with the household (id + ETag), and
/// the same call seeds the organizer's <c>People</c> row
/// (<c>Role = Organizer</c>, <c>IsChild = false</c>, organizer object id bound).
/// Runs in the shared Development factory, where the deterministic dev organizer
/// satisfies the <c>Organizer</c> policy without a token.
/// </summary>
public sealed class HouseholdCreationTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public HouseholdCreationTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Post_households_creates_household_and_organizer_person_row()
    {
        using var client = _factory.CreateClient();

        using var response = await client.PostAsJsonAsync(
            new Uri("/households", UriKind.Relative),
            new { name = "The Cavaliere House" });

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Created, body);

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        var householdId = root.GetProperty("householdId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(householdId));
        Assert.Equal("The Cavaliere House", root.GetProperty("name").GetString());
        Assert.Equal(
            OrganizerAuthorization.DevOrganizerSubject,
            root.GetProperty("organizerObjectId").GetString());
        // The created household carries its optimistic-concurrency ETag.
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("eTag").GetString()));

        // The household is immediately readable at the created resource.
        using var getResponse = await client.GetAsync(
            new Uri($"/households/{householdId}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);

        // The organizer's People row was seeded in the same operation so the
        // roster is never left without an owner.
        var people = _factory.Services.GetRequiredService<IEntityRepository<PersonEntity>>();
        var roster = await people.ListAsync(householdId!);

        var organizer = Assert.Single(roster);
        Assert.Equal(OrganizerAuthorization.OrganizerRole, organizer.Role);
        Assert.False(organizer.IsChild);
        Assert.Equal(OrganizerAuthorization.DevOrganizerSubject, organizer.OrganizerObjectId);
        Assert.Equal(householdId, organizer.PartitionKey);
    }
}
