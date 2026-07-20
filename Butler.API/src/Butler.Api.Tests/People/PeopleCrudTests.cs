using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.People;

/// <summary>
/// Criteria (H3): the People endpoints round-trip create, list, single-read,
/// update, and delete for a household, persisting <c>Role</c> and the
/// <c>IsChild</c> flag. Runs in the shared Development factory, where the
/// deterministic dev organizer satisfies the <c>Organizer</c> policy on the
/// mutating endpoints without a token.
/// </summary>
public sealed class PeopleCrudTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public PeopleCrudTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task AddParticipant()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var peopleUri = new Uri($"/households/{householdId}/people", UriKind.Relative);

        // Create -> 201 with a server-generated personId, a Participant role, and an ETag.
        using var createResponse = await client.PostAsJsonAsync(
            peopleUri,
            new { displayName = "Alex", role = "Participant", isChild = false, claimColor = "#33aa88" });

        var createBody = await createResponse.Content.ReadAsStringAsync();
        Assert.True(createResponse.StatusCode == HttpStatusCode.Created, createBody);

        using var createDoc = JsonDocument.Parse(createBody);
        var created = createDoc.RootElement;
        var personId = created.GetProperty("personId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(personId));
        Assert.Equal("Alex", created.GetProperty("displayName").GetString());
        Assert.Equal("Participant", created.GetProperty("role").GetString());
        Assert.False(created.GetProperty("isChild").GetBoolean());
        Assert.Equal("#33aa88", created.GetProperty("claimColor").GetString());
        var etag = created.GetProperty("eTag").GetString();
        Assert.False(string.IsNullOrWhiteSpace(etag));

        // The Location header points at the single-person read.
        var personUri = new Uri($"/households/{householdId}/people/{personId}", UriKind.Relative);
        using var getResponse = await client.GetAsync(personUri);
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        using var getDoc = JsonDocument.Parse(await getResponse.Content.ReadAsStringAsync());
        Assert.Equal("Participant", getDoc.RootElement.GetProperty("role").GetString());

        // List -> the created participant is present.
        using var listResponse = await client.GetAsync(peopleUri);
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        using var listDoc = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
        var listed = Assert.Single(listDoc.RootElement.EnumerateArray().ToList());
        Assert.Equal(personId, listed.GetProperty("personId").GetString());

        // Update -> 200 with the new name and a fresh ETag.
        using var updateRequest = new HttpRequestMessage(HttpMethod.Put, personUri)
        {
            Content = JsonContent.Create(
                new { displayName = "Alexander", role = "Participant", isChild = false, claimColor = "#112233" }),
        };
        updateRequest.Headers.TryAddWithoutValidation("If-Match", etag);
        using var updateResponse = await client.SendAsync(updateRequest);

        var updateBody = await updateResponse.Content.ReadAsStringAsync();
        Assert.True(updateResponse.StatusCode == HttpStatusCode.OK, updateBody);
        using var updateDoc = JsonDocument.Parse(updateBody);
        var updated = updateDoc.RootElement;
        Assert.Equal("Alexander", updated.GetProperty("displayName").GetString());
        Assert.Equal("#112233", updated.GetProperty("claimColor").GetString());
        Assert.NotEqual(etag, updated.GetProperty("eTag").GetString());

        // Delete -> 204, and the participant is then gone.
        using var deleteResponse = await client.DeleteAsync(personUri);
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        using var afterDelete = await client.GetAsync(personUri);
        Assert.Equal(HttpStatusCode.NotFound, afterDelete.StatusCode);
    }

    [Fact]
    public async Task AddChild()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var peopleUri = new Uri($"/households/{householdId}/people", UriKind.Relative);

        // Create a child -> IsChild = true is persisted on the stored row.
        using var createResponse = await client.PostAsJsonAsync(
            peopleUri,
            new { displayName = "Sam", role = "Participant", isChild = true, claimColor = (string?)null });

        var createBody = await createResponse.Content.ReadAsStringAsync();
        Assert.True(createResponse.StatusCode == HttpStatusCode.Created, createBody);

        using var createDoc = JsonDocument.Parse(createBody);
        var created = createDoc.RootElement;
        var personId = created.GetProperty("personId").GetString();
        Assert.True(created.GetProperty("isChild").GetBoolean());

        // Re-reading the stored row confirms the child flag survived the round-trip.
        var personUri = new Uri($"/households/{householdId}/people/{personId}", UriKind.Relative);
        using var getResponse = await client.GetAsync(personUri);
        using var getDoc = JsonDocument.Parse(await getResponse.Content.ReadAsStringAsync());
        Assert.True(getDoc.RootElement.GetProperty("isChild").GetBoolean());
        var etag = getDoc.RootElement.GetProperty("eTag").GetString();

        // Updating with IsChild = true keeps it persisted.
        using var updateRequest = new HttpRequestMessage(HttpMethod.Put, personUri)
        {
            Content = JsonContent.Create(
                new { displayName = "Sam", role = "Participant", isChild = true, claimColor = (string?)null }),
        };
        updateRequest.Headers.TryAddWithoutValidation("If-Match", etag);
        using var updateResponse = await client.SendAsync(updateRequest);
        using var updateDoc = JsonDocument.Parse(await updateResponse.Content.ReadAsStringAsync());
        Assert.True(updateDoc.RootElement.GetProperty("isChild").GetBoolean());
    }
}
