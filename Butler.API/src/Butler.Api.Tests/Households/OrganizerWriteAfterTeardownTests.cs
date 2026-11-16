using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Azure.Data.Tables;
using Butler.Api.Infrastructure.Chores;
using Butler.Api.Infrastructure.HubDevices;
using Butler.Api.Infrastructure.People;
using Butler.Api.Infrastructure.Rooms;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Households;

/// <summary>
/// Criteria (#295 AC1, AC2): an organizer create or update that targets a
/// household that does not exist, after teardown or because it never existed,
/// answers an RFC 7807 <c>404</c> titled <c>Household not found.</c> and writes no
/// row. Covers rooms, people, chores (create, update, deactivate) and hub-device
/// pairing.
/// </summary>
public sealed class OrganizerWriteAfterTeardownTests : IClassFixture<ButlerApiFactory>
{
    private const string HouseholdName = "Home";

    private readonly ButlerApiFactory _factory;

    public OrganizerWriteAfterTeardownTests(ButlerApiFactory factory) => _factory = factory;

    private static Uri Route(string path) => new(path, UriKind.Relative);

    private static async Task<string> CreateHouseholdAsync(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync(Route("/households"), new { name = HouseholdName });
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Created, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("householdId").GetString()!;
    }

    private static async Task TearDownAsync(HttpClient client, string householdId)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, Route($"/households/{householdId}"))
        {
            Content = new StringContent(
                JsonSerializer.Serialize(new { confirmName = HouseholdName }),
                Encoding.UTF8,
                "application/json"),
        };
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    private static async Task<string> CreateAsync(HttpClient client, string path, object body, string idProperty)
    {
        using var response = await client.PostAsJsonAsync(Route(path), body);
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Created, text);
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.GetProperty(idProperty).GetString()!;
    }

    private static async Task<HttpResponseMessage> PutAsync(HttpClient client, string path, object body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, Route(path)) { Content = JsonContent.Create(body) };
        request.Headers.TryAddWithoutValidation("If-Match", "*");
        return await client.SendAsync(request);
    }

    private static async Task AssertHouseholdNotFoundAsync(HttpResponseMessage response, string householdId)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.NotFound, body);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        Assert.Equal(404, root.GetProperty("status").GetInt32());
        Assert.Equal("Household not found.", root.GetProperty("title").GetString());
        Assert.Equal($"No household with id '{householdId}' exists.", root.GetProperty("detail").GetString());
        Assert.Equal(householdId, root.GetProperty("householdId").GetString());
    }

    private async Task<int> CountRowsAsync<TEntity>(string householdId)
        where TEntity : class, ITableEntity, new()
    {
        var rows = await _factory.Services.GetRequiredService<IEntityRepository<TEntity>>().ListAsync(householdId);
        return rows.Count;
    }

    private static object RoomBody(string name = "Kitchen") => new { name, sortOrder = 1 };

    private static object PersonBody(string displayName = "Sam") =>
        new { displayName, role = "Participant", isChild = false, claimColor = (string?)null };

    private static object ChoreBody(string roomId, string title = "Dishes") =>
        new { title, roomId, cadence = "Daily", effort = 2, minAge = (int?)null };

    private static object ChoreUpdateBody(string roomId) =>
        new { title = "Dishes", roomId, cadence = "Daily", effort = 2, minAge = (int?)null, active = true };

    [Fact]
    public async Task Creating_a_room_after_teardown_is_404_problem_and_writes_no_row()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        await TearDownAsync(client, householdId);

        using var response = await client.PostAsJsonAsync(Route($"/households/{householdId}/rooms"), RoomBody());

        await AssertHouseholdNotFoundAsync(response, householdId);
        Assert.Equal(0, await CountRowsAsync<RoomEntity>(householdId));
    }

    [Fact]
    public async Task Updating_a_room_after_teardown_is_household_404_and_writes_no_row()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var roomId = await CreateAsync(client, $"/households/{householdId}/rooms", RoomBody(), "roomId");
        await TearDownAsync(client, householdId);

        using var response = await PutAsync(client, $"/households/{householdId}/rooms/{roomId}", RoomBody("Den"));

        await AssertHouseholdNotFoundAsync(response, householdId);
        Assert.Equal(0, await CountRowsAsync<RoomEntity>(householdId));
    }

    [Fact]
    public async Task Creating_a_person_after_teardown_is_404_problem_and_writes_no_row()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        await TearDownAsync(client, householdId);

        using var response = await client.PostAsJsonAsync(Route($"/households/{householdId}/people"), PersonBody());

        await AssertHouseholdNotFoundAsync(response, householdId);
        Assert.Equal(0, await CountRowsAsync<PersonEntity>(householdId));
    }

    [Fact]
    public async Task Updating_a_person_after_teardown_is_household_404_and_writes_no_row()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var personId = await CreateAsync(client, $"/households/{householdId}/people", PersonBody(), "personId");
        await TearDownAsync(client, householdId);

        using var response = await PutAsync(
            client, $"/households/{householdId}/people/{personId}", PersonBody("Alex"));

        await AssertHouseholdNotFoundAsync(response, householdId);
        Assert.Equal(0, await CountRowsAsync<PersonEntity>(householdId));
    }

    [Fact]
    public async Task Creating_a_chore_after_teardown_is_404_problem_and_writes_no_row()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var roomId = await CreateAsync(client, $"/households/{householdId}/rooms", RoomBody(), "roomId");
        await TearDownAsync(client, householdId);

        using var response = await client.PostAsJsonAsync(
            Route($"/households/{householdId}/chores"), ChoreBody(roomId));

        await AssertHouseholdNotFoundAsync(response, householdId);
        Assert.Equal(0, await CountRowsAsync<ChoreEntity>(householdId));
        Assert.Equal(0, await CountRowsAsync<RoomEntity>(householdId));
    }

    [Fact]
    public async Task Updating_or_deactivating_a_chore_after_teardown_is_household_404_and_writes_no_row()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var roomId = await CreateAsync(client, $"/households/{householdId}/rooms", RoomBody(), "roomId");
        var choreId = await CreateAsync(client, $"/households/{householdId}/chores", ChoreBody(roomId), "choreId");
        await TearDownAsync(client, householdId);

        using var update = await PutAsync(
            client, $"/households/{householdId}/chores/{choreId}", ChoreUpdateBody(roomId));
        using var deactivate = await client.PostAsync(
            Route($"/households/{householdId}/chores/{choreId}/deactivate"), content: null);

        await AssertHouseholdNotFoundAsync(update, householdId);
        await AssertHouseholdNotFoundAsync(deactivate, householdId);
        Assert.Equal(0, await CountRowsAsync<ChoreEntity>(householdId));
    }

    [Fact]
    public async Task Pairing_a_hub_device_after_teardown_is_404_problem_and_writes_no_row()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        await TearDownAsync(client, householdId);

        using var response = await client.PostAsJsonAsync(
            Route($"/households/{householdId}/hub-devices/pair"), new { deviceName = "Kitchen hub" });

        await AssertHouseholdNotFoundAsync(response, householdId);
        Assert.Equal(0, await CountRowsAsync<HubDeviceEntity>(householdId));
    }

    [Theory]
    [InlineData("rooms")]
    [InlineData("people")]
    [InlineData("chores")]
    [InlineData("hub-devices/pair")]
    public async Task Organizer_writes_to_a_household_that_never_existed_are_404_problem(string route)
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        object body = route switch
        {
            "rooms" => RoomBody(),
            "people" => PersonBody(),
            "chores" => ChoreBody("room"),
            _ => new { deviceName = "Kitchen hub" },
        };

        using var response = await client.PostAsJsonAsync(Route($"/households/{householdId}/{route}"), body);

        await AssertHouseholdNotFoundAsync(response, householdId);
        Assert.Equal(0, await CountRowsAsync<RoomEntity>(householdId));
        Assert.Equal(0, await CountRowsAsync<PersonEntity>(householdId));
        Assert.Equal(0, await CountRowsAsync<ChoreEntity>(householdId));
        Assert.Equal(0, await CountRowsAsync<HubDeviceEntity>(householdId));
    }
}
