using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Chores;

/// <summary>
/// Criteria (H4): a chore must reference a real room in the same household and
/// carry a positive effort. A dangling room reference or a non-positive effort is
/// a <c>400</c> RFC 7807 problem details that persists no row.
/// </summary>
public sealed class ChoreValidationTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public ChoreValidationTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task RejectUnknownRoom_returns_400_and_persists_nothing()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var choresUri = new Uri($"/households/{householdId}/chores", UriKind.Relative);

        using var response = await client.PostAsJsonAsync(
            choresUri,
            new { title = "Dishes", roomId = "does-not-exist", cadence = "Daily", effort = 3, minAge = (int?)null });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        // Nothing persisted: the household's chore list is empty.
        using var list = await client.GetAsync(choresUri);
        using var doc = JsonDocument.Parse(await list.Content.ReadAsStringAsync());
        Assert.Empty(doc.RootElement.EnumerateArray().ToList());
    }

    [Fact]
    public async Task RejectUnknownRoom_on_update_returns_400_and_leaves_row_unchanged()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var roomId = await ChoreTestHelper.CreateRoomAsync(client, householdId, "Kitchen", 1);
        var (choreId, etag) = await ChoreTestHelper.CreateChoreAsync(client, householdId, roomId);
        var choreUri = new Uri($"/households/{householdId}/chores/{choreId}", UriKind.Relative);

        using var request = new HttpRequestMessage(HttpMethod.Put, choreUri)
        {
            Content = JsonContent.Create(
                new { title = "Dishes", roomId = "nope", cadence = "Daily", effort = 3, minAge = (int?)null, active = true }),
        };
        request.Headers.TryAddWithoutValidation("If-Match", etag);
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        // The stored row still points at the original room and keeps its ETag.
        using var get = await client.GetAsync(choreUri);
        using var doc = JsonDocument.Parse(await get.Content.ReadAsStringAsync());
        Assert.Equal(roomId, doc.RootElement.GetProperty("roomId").GetString());
        Assert.Equal(etag, doc.RootElement.GetProperty("eTag").GetString());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-4)]
    public async Task RejectNonPositiveEffort_returns_400(int effort)
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var choresUri = new Uri($"/households/{householdId}/chores", UriKind.Relative);
        var roomId = await ChoreTestHelper.CreateRoomAsync(client, householdId, "Kitchen", 1);

        using var response = await client.PostAsJsonAsync(
            choresUri,
            new { title = "Dishes", roomId, cadence = "Daily", effort, minAge = (int?)null });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task RejectUnknownCadence_returns_400()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var choresUri = new Uri($"/households/{householdId}/chores", UriKind.Relative);
        var roomId = await ChoreTestHelper.CreateRoomAsync(client, householdId, "Kitchen", 1);

        using var response = await client.PostAsJsonAsync(
            choresUri,
            new { title = "Dishes", roomId, cadence = "Hourly", effort = 3, minAge = (int?)null });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
