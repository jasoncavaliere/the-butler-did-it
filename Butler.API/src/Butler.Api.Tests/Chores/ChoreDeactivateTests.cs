using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Chores;

/// <summary>
/// Criterion (H4): <c>POST /households/{householdId}/chores/{choreId}/deactivate</c>
/// sets <c>Active = false</c>, retains the row (rather than deleting it) so Epic
/// 40 history stays referential, and returns <c>200</c>. Reactivation is a
/// <c>PUT</c> with <c>Active = true</c>.
/// </summary>
public sealed class ChoreDeactivateTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public ChoreDeactivateTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task DeactivateChore_sets_active_false_and_retains_the_row()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var roomId = await ChoreTestHelper.CreateRoomAsync(client, householdId, "Kitchen", 1);
        var (choreId, _) = await ChoreTestHelper.CreateChoreAsync(client, householdId, roomId);
        var choreUri = new Uri($"/households/{householdId}/chores/{choreId}", UriKind.Relative);
        var deactivateUri = new Uri(
            $"/households/{householdId}/chores/{choreId}/deactivate", UriKind.Relative);

        // Deactivate -> 200 with Active = false.
        using var deactivateResponse = await client.PostAsync(deactivateUri, content: null);
        Assert.Equal(HttpStatusCode.OK, deactivateResponse.StatusCode);
        using var deactivateDoc = JsonDocument.Parse(await deactivateResponse.Content.ReadAsStringAsync());
        Assert.False(deactivateDoc.RootElement.GetProperty("active").GetBoolean());

        // Row retained: still readable, still Active = false.
        using var getResponse = await client.GetAsync(choreUri);
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        using var getDoc = JsonDocument.Parse(await getResponse.Content.ReadAsStringAsync());
        Assert.False(getDoc.RootElement.GetProperty("active").GetBoolean());
        var deactivatedETag = getDoc.RootElement.GetProperty("eTag").GetString();

        // Reactivation via PUT Active = true.
        using var reactivateRequest = new HttpRequestMessage(HttpMethod.Put, choreUri)
        {
            Content = JsonContent.Create(
                new { title = "Dishes", roomId, cadence = "Daily", effort = 3, minAge = (int?)null, active = true }),
        };
        reactivateRequest.Headers.TryAddWithoutValidation("If-Match", deactivatedETag);
        using var reactivateResponse = await client.SendAsync(reactivateRequest);
        Assert.Equal(HttpStatusCode.OK, reactivateResponse.StatusCode);
        using var reactivateDoc = JsonDocument.Parse(await reactivateResponse.Content.ReadAsStringAsync());
        Assert.True(reactivateDoc.RootElement.GetProperty("active").GetBoolean());
    }

    [Fact]
    public async Task Deactivate_unknown_chore_returns_404()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var deactivateUri = new Uri(
            $"/households/{householdId}/chores/does-not-exist/deactivate", UriKind.Relative);

        using var response = await client.PostAsync(deactivateUri, content: null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
