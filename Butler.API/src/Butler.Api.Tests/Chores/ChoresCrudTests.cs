using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Chores;

/// <summary>
/// Criteria (H4): the Chores endpoints round-trip create, list, single-read, and
/// update for a household, with a chore attached to a real room. Runs in the
/// shared Development factory, where the deterministic dev organizer satisfies the
/// <c>Organizer</c> policy on the mutating endpoints without a token.
/// </summary>
public sealed class ChoresCrudTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public ChoresCrudTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task CreateChoreWithValidRoom_persists_and_round_trips()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var choresUri = new Uri($"/households/{householdId}/chores", UriKind.Relative);
        var roomId = await ChoreTestHelper.CreateRoomAsync(client, householdId, "Kitchen", 1);

        // Create -> 201 with server-generated choreId, Active defaulting true, and an ETag.
        using var createResponse = await client.PostAsJsonAsync(
            choresUri,
            new { title = "Dishes", roomId, cadence = "Daily", effort = 3, minAge = (int?)10 });

        var createBody = await createResponse.Content.ReadAsStringAsync();
        Assert.True(createResponse.StatusCode == HttpStatusCode.Created, createBody);

        using var createDoc = JsonDocument.Parse(createBody);
        var created = createDoc.RootElement;
        var choreId = created.GetProperty("choreId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(choreId));
        Assert.Equal("Dishes", created.GetProperty("title").GetString());
        Assert.Equal(roomId, created.GetProperty("roomId").GetString());
        Assert.Equal("Daily", created.GetProperty("cadence").GetString());
        Assert.Equal(3, created.GetProperty("effort").GetInt32());
        Assert.Equal(10, created.GetProperty("minAge").GetInt32());
        Assert.True(created.GetProperty("active").GetBoolean());
        var etag = created.GetProperty("eTag").GetString();
        Assert.False(string.IsNullOrWhiteSpace(etag));

        // The Location header points at the single-chore read.
        var choreUri = new Uri($"/households/{householdId}/chores/{choreId}", UriKind.Relative);
        using var getResponse = await client.GetAsync(choreUri);
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);

        // List -> the created chore is present.
        using var listResponse = await client.GetAsync(choresUri);
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        using var listDoc = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
        var listed = Assert.Single(listDoc.RootElement.EnumerateArray().ToList());
        Assert.Equal(choreId, listed.GetProperty("choreId").GetString());

        // Update -> 200 with the new fields and a fresh ETag.
        using var updateRequest = new HttpRequestMessage(HttpMethod.Put, choreUri)
        {
            Content = JsonContent.Create(
                new { title = "Wash dishes", roomId, cadence = "Weekly", effort = 5, minAge = (int?)null, active = true }),
        };
        updateRequest.Headers.TryAddWithoutValidation("If-Match", etag);
        using var updateResponse = await client.SendAsync(updateRequest);

        var updateBody = await updateResponse.Content.ReadAsStringAsync();
        Assert.True(updateResponse.StatusCode == HttpStatusCode.OK, updateBody);
        using var updateDoc = JsonDocument.Parse(updateBody);
        var updated = updateDoc.RootElement;
        Assert.Equal("Wash dishes", updated.GetProperty("title").GetString());
        Assert.Equal("Weekly", updated.GetProperty("cadence").GetString());
        Assert.Equal(5, updated.GetProperty("effort").GetInt32());
        Assert.Equal(JsonValueKind.Null, updated.GetProperty("minAge").ValueKind);
        Assert.NotEqual(etag, updated.GetProperty("eTag").GetString());
    }

    [Fact]
    public async Task Cadence_is_normalized_case_insensitively()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var choresUri = new Uri($"/households/{householdId}/chores", UriKind.Relative);
        var roomId = await ChoreTestHelper.CreateRoomAsync(client, householdId, "Garage", 1);

        using var createResponse = await client.PostAsJsonAsync(
            choresUri,
            new { title = "Sweep", roomId, cadence = "weekly", effort = 2, minAge = (int?)null });

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        using var doc = JsonDocument.Parse(await createResponse.Content.ReadAsStringAsync());
        Assert.Equal("Weekly", doc.RootElement.GetProperty("cadence").GetString());
    }
}
