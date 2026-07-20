using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.People;

/// <summary>
/// Criteria (H3): a household must always retain at least one organizer. Demoting
/// or deleting the sole remaining organizer is rejected with <c>400</c> RFC 7807
/// problem details and leaves the row unchanged; once a second organizer exists,
/// the first can be demoted and removed. The household (and its seeded organizer
/// row) is created through <c>POST /households</c> in the shared Development
/// factory, where the dev organizer satisfies the <c>Organizer</c> policy.
/// </summary>
public sealed class PreventLastOrganizerRemovalTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public PreventLastOrganizerRemovalTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task PreventLastOrganizerRemoval()
    {
        using var client = _factory.CreateClient();

        // Creating the household seeds exactly one organizer row (H1).
        var householdId = await CreateHouseholdAsync(client);
        var peopleUri = new Uri($"/households/{householdId}/people", UriKind.Relative);

        var organizer = await SingleOrganizerAsync(client, peopleUri);
        var organizerId = organizer.GetProperty("personId").GetString();
        var etag = organizer.GetProperty("eTag").GetString();
        var organizerUri = new Uri($"/households/{householdId}/people/{organizerId}", UriKind.Relative);

        // Demoting the sole organizer to Participant -> 400 problem details.
        using var demoteRequest = new HttpRequestMessage(HttpMethod.Put, organizerUri)
        {
            Content = JsonContent.Create(
                new { displayName = "Owner", role = "Participant", isChild = false, claimColor = (string?)null }),
        };
        demoteRequest.Headers.TryAddWithoutValidation("If-Match", etag);
        using var demote = await client.SendAsync(demoteRequest);
        await AssertLastOrganizerRejected(demote);

        // The row is unchanged: still an organizer.
        using var afterDemote = await client.GetAsync(organizerUri);
        using var afterDemoteDoc = JsonDocument.Parse(await afterDemote.Content.ReadAsStringAsync());
        Assert.Equal("Organizer", afterDemoteDoc.RootElement.GetProperty("role").GetString());

        // Deleting the sole organizer -> 400 problem details, and the row survives.
        using var delete = await client.DeleteAsync(organizerUri);
        await AssertLastOrganizerRejected(delete);

        using var afterDelete = await client.GetAsync(organizerUri);
        Assert.Equal(HttpStatusCode.OK, afterDelete.StatusCode);
    }

    [Fact]
    public async Task Organizer_can_be_demoted_and_removed_once_a_second_organizer_exists()
    {
        using var client = _factory.CreateClient();

        var householdId = await CreateHouseholdAsync(client);
        var peopleUri = new Uri($"/households/{householdId}/people", UriKind.Relative);

        var firstOrganizer = await SingleOrganizerAsync(client, peopleUri);
        var firstId = firstOrganizer.GetProperty("personId").GetString();
        var firstEtag = firstOrganizer.GetProperty("eTag").GetString();
        var firstUri = new Uri($"/households/{householdId}/people/{firstId}", UriKind.Relative);

        // Add a second organizer so the guard no longer bites.
        using var createSecond = await client.PostAsJsonAsync(
            peopleUri,
            new { displayName = "Co-owner", role = "Organizer", isChild = false, claimColor = (string?)null });
        Assert.Equal(HttpStatusCode.Created, createSecond.StatusCode);

        // Now the first organizer can be demoted to Participant.
        using var demoteRequest = new HttpRequestMessage(HttpMethod.Put, firstUri)
        {
            Content = JsonContent.Create(
                new { displayName = "Owner", role = "Participant", isChild = false, claimColor = (string?)null }),
        };
        demoteRequest.Headers.TryAddWithoutValidation("If-Match", firstEtag);
        using var demote = await client.SendAsync(demoteRequest);
        var demoteBody = await demote.Content.ReadAsStringAsync();
        Assert.True(demote.StatusCode == HttpStatusCode.OK, demoteBody);
        using var demoteDoc = JsonDocument.Parse(demoteBody);
        Assert.Equal("Participant", demoteDoc.RootElement.GetProperty("role").GetString());

        // And can then be deleted, since the second organizer remains.
        using var delete = await client.DeleteAsync(firstUri);
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
    }

    private static async Task<string> CreateHouseholdAsync(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri("/households", UriKind.Relative),
            new { name = "Cavaliere House" });
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Created, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("householdId").GetString()!;
    }

    private static async Task<JsonElement> SingleOrganizerAsync(HttpClient client, Uri peopleUri)
    {
        // The roster read (T1) is the trimmed claimable projection - no role or
        // ETag. A freshly seeded household holds exactly one person (its organizer),
        // so take that entry's id and read the single-person detail for the CRUD
        // fields (role, ETag) the guard tests need.
        using var listResponse = await client.GetAsync(peopleUri);
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        using var listDoc = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
        var entry = Assert.Single(listDoc.RootElement.EnumerateArray().ToList());
        var personId = entry.GetProperty("personId").GetString();

        var personUri = new Uri($"{peopleUri.OriginalString}/{personId}", UriKind.Relative);
        using var detailResponse = await client.GetAsync(personUri);
        Assert.Equal(HttpStatusCode.OK, detailResponse.StatusCode);
        using var detailDoc = JsonDocument.Parse(await detailResponse.Content.ReadAsStringAsync());
        var organizer = detailDoc.RootElement;
        Assert.Equal("Organizer", organizer.GetProperty("role").GetString());
        // Clone so the element survives disposal of the JsonDocument.
        return organizer.Clone();
    }

    private static async Task AssertLastOrganizerRejected(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(400, doc.RootElement.GetProperty("status").GetInt32());
    }
}
