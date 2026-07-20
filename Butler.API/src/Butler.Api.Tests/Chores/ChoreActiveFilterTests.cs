using System.Net;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Chores;

/// <summary>
/// Criterion (H4): <c>GET /households/{householdId}/chores</c> filters on the
/// <c>Active</c> query parameter when supplied (<c>?active=true</c> /
/// <c>?active=false</c>) and returns every chore when it is omitted.
/// </summary>
public sealed class ChoreActiveFilterTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public ChoreActiveFilterTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task List_filters_on_the_active_query_parameter()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var roomId = await ChoreTestHelper.CreateRoomAsync(client, householdId, "Kitchen", 1);

        // Two active chores; deactivate one so the household has one of each.
        var (activeId, _) = await ChoreTestHelper.CreateChoreAsync(client, householdId, roomId, title: "Active chore");
        var (inactiveId, _) = await ChoreTestHelper.CreateChoreAsync(client, householdId, roomId, title: "Inactive chore");
        using var deactivate = await client.PostAsync(
            new Uri($"/households/{householdId}/chores/{inactiveId}/deactivate", UriKind.Relative),
            content: null);
        Assert.Equal(HttpStatusCode.OK, deactivate.StatusCode);

        // No filter -> both chores.
        Assert.Equal(2, (await ListIds(client, householdId, query: null)).Count);

        // active=true -> only the active chore.
        var activeOnly = await ListIds(client, householdId, query: "?active=true");
        Assert.Equal([activeId], activeOnly);

        // active=false -> only the deactivated chore.
        var inactiveOnly = await ListIds(client, householdId, query: "?active=false");
        Assert.Equal([inactiveId], inactiveOnly);
    }

    private static async Task<List<string?>> ListIds(HttpClient client, string householdId, string? query)
    {
        var uri = new Uri($"/households/{householdId}/chores{query}", UriKind.Relative);
        using var response = await client.GetAsync(uri);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.EnumerateArray()
            .Select(chore => chore.GetProperty("choreId").GetString())
            .ToList();
    }
}
