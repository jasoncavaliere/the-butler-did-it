using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.TapToClaim;

/// <summary>
/// Criteria (T1): claiming a person with no password and no organizer JWT returns
/// a lightweight participant session scoped to exactly <c>(householdId, personId)</c>.
/// Runs in the shared Development factory, where a person can be seeded through
/// the organizer-gated create (the dev organizer satisfies the policy); the claim
/// itself needs no token.
/// </summary>
public sealed class ClaimHappyPathTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public ClaimHappyPathTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Claiming_a_person_returns_a_session_scoped_to_that_person()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var peopleUri = new Uri($"/households/{householdId}/people", UriKind.Relative);

        // Seed a person on the roster.
        using var createResponse = await client.PostAsJsonAsync(
            peopleUri,
            new { displayName = "Robin", role = "Participant", isChild = true, claimColor = "#5522aa" });
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        using var createDoc = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        var personId = createDoc.RootElement.GetProperty("personId").GetString();

        // Claim it (no auth) -> 200 with the session.
        var claimUri = new Uri($"/households/{householdId}/people/{personId}/claim", UriKind.Relative);
        using var claimResponse = await client.PostAsync(claimUri, content: null);

        var claimBody = await claimResponse.Content.ReadAsStringAsync();
        Assert.True(claimResponse.StatusCode == HttpStatusCode.OK, claimBody);

        using var claimDoc = JsonDocument.Parse(claimBody);
        var session = claimDoc.RootElement;
        Assert.Equal(householdId, session.GetProperty("householdId").GetString());
        Assert.Equal(personId, session.GetProperty("personId").GetString());
        Assert.Equal("Robin", session.GetProperty("displayName").GetString());
        Assert.Equal("#5522aa", session.GetProperty("claimColor").GetString());
        Assert.True(session.GetProperty("isChild").GetBoolean());

        // The token is opaque but decodes back to exactly the claimed scope, which
        // is the contract Epic 40 C4 consumes to attribute a completion.
        var token = session.GetProperty("token").GetString();
        Assert.False(string.IsNullOrWhiteSpace(token));
        Assert.True(ParticipantSession.TryDecode(token, out var scopedHousehold, out var scopedPerson));
        Assert.Equal(householdId, scopedHousehold);
        Assert.Equal(personId, scopedPerson);
    }
}
