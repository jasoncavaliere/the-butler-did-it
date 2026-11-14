using System.Collections;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Azure.Data.Tables;
using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Households;

/// <summary>
/// Criteria (#124 AC1-AC9): <c>DELETE /households/{householdId}</c> with the exact
/// household name as <c>confirmName</c> answers <c>204</c> and deletes every row
/// in that household's partition of every table registered with
/// <c>AddTableRepository</c> (a table added later included), leaving every other
/// household intact. A missing or inexact name is an RFC 7807 <c>400</c>, an
/// unknown household an RFC 7807 <c>404</c>, and a participant session or hub
/// device a <c>403</c>; none of them delete anything. After teardown the
/// household's hub-device and participant tokens authenticate nobody (<c>401</c>).
/// </summary>
public sealed class HouseholdTeardownEndpointTests : IClassFixture<ButlerApiFactory>
{
    private const string HouseholdName = "Home";

    private readonly ButlerApiFactory _factory;

    public HouseholdTeardownEndpointTests(ButlerApiFactory factory) => _factory = factory;

    private static Uri HouseholdRoute(string householdId) =>
        new($"/households/{householdId}", UriKind.Relative);

    private static Uri EventsRoute(string householdId) =>
        new($"/households/{householdId}/events", UriKind.Relative);

    private static async Task<string> CreateHouseholdAsync(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri("/households", UriKind.Relative),
            new { name = HouseholdName });
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Created, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("householdId").GetString()!;
    }

    private static async Task<string> PairDeviceAsync(HttpClient client, string householdId)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/hub-devices/pair", UriKind.Relative),
            new { deviceName = "Kitchen hub" });
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("token").GetString()!;
    }

    private static HttpRequestMessage DeleteRequest(string householdId, string? json)
    {
        var request = new HttpRequestMessage(HttpMethod.Delete, HouseholdRoute(householdId));
        // null sends no body and no Content-Type at all; "" sends an empty JSON body.
        if (json is not null)
        {
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        return request;
    }

    private static string ConfirmBody(string confirmName) =>
        JsonSerializer.Serialize(new { confirmName });

    private static async Task<HttpResponseMessage> TearDownAsync(HttpClient client, string householdId)
    {
        using var request = DeleteRequest(householdId, ConfirmBody(HouseholdName));
        return await client.SendAsync(request);
    }

    private static async Task<HttpStatusCode> GetHouseholdStatusAsync(HttpClient client, string householdId)
    {
        using var response = await client.GetAsync(HouseholdRoute(householdId));
        return response.StatusCode;
    }

    private static async Task AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == status, body);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal((int)status, doc.RootElement.GetProperty("status").GetInt32());
    }

    // Every entity type that has a purger, i.e. every table registered with
    // AddTableRepository. Read from DI so the tests never hard-code a table list.
    private static Type[] RegisteredEntityTypes(IServiceProvider services) =>
        services.GetServices<IHouseholdPartitionPurger>()
            .Select(purger => purger.EntityType)
            .Distinct()
            .ToArray();

    private static object RepositoryFor(IServiceProvider services, Type entityType) =>
        services.GetRequiredService(typeof(IEntityRepository<>).MakeGenericType(entityType));

    private static async Task SeedRowAsync(IServiceProvider services, Type entityType, string householdId)
    {
        var repository = RepositoryFor(services, entityType);
        var entity = (ITableEntity)Activator.CreateInstance(entityType)!;
        entity.RowKey = $"seed-{Guid.NewGuid():N}";
        var method = typeof(IEntityRepository<>).MakeGenericType(entityType)
            .GetMethod(nameof(IEntityRepository<FakeEntity>.UpsertAsync))!;
        await (Task)method.Invoke(repository, [householdId, entity, CancellationToken.None])!;
    }

    private static async Task<int> CountRowsAsync(IServiceProvider services, Type entityType, string householdId)
    {
        var repository = RepositoryFor(services, entityType);
        var method = typeof(IEntityRepository<>).MakeGenericType(entityType)
            .GetMethod(nameof(IEntityRepository<FakeEntity>.ListAsync))!;
        var task = (Task)method.Invoke(repository, [householdId, CancellationToken.None])!;
        await task;
        var rows = (IEnumerable)task.GetType().GetProperty(nameof(Task<int>.Result))!.GetValue(task)!;
        return rows.Cast<object>().Count();
    }

    private static async Task<Dictionary<Type, int>> CountAllAsync(IServiceProvider services, string householdId)
    {
        var counts = new Dictionary<Type, int>();
        foreach (var entityType in RegisteredEntityTypes(services))
        {
            counts[entityType] = await CountRowsAsync(services, entityType, householdId);
        }

        return counts;
    }

    [Fact]
    public async Task An_organizer_with_the_exact_name_tears_the_household_down_with_204()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var response = await TearDownAsync(client, householdId);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, await GetHouseholdStatusAsync(client, householdId));
        Assert.All(await CountAllAsync(_factory.Services, householdId), pair => Assert.Equal(0, pair.Value));
    }

    [Fact]
    public async Task Teardown_empties_every_registered_table_for_one_household_and_leaves_the_other_intact()
    {
        using var client = _factory.CreateClient();
        var householdA = await CreateHouseholdAsync(client);
        var householdB = await CreateHouseholdAsync(client);
        var services = _factory.Services;

        // Guard: every registered table has exactly one purger, so seeding every
        // purger's entity type seeds every registered table.
        var tableNames = services.GetServices<TableRegistration>()
            .Select(registration => registration.TableName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Count();
        var entityTypes = RegisteredEntityTypes(services);
        Assert.Equal(tableNames, entityTypes.Length);

        foreach (var entityType in entityTypes)
        {
            await SeedRowAsync(services, entityType, householdA);
            await SeedRowAsync(services, entityType, householdB);
        }

        var before = await CountAllAsync(services, householdB);
        Assert.All(before, pair => Assert.True(pair.Value > 0, pair.Key.Name));

        using var response = await TearDownAsync(client, householdA);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.All(await CountAllAsync(services, householdA), pair => Assert.Equal(0, pair.Value));
        Assert.Equal(before, await CountAllAsync(services, householdB));
        Assert.Equal(HttpStatusCode.OK, await GetHouseholdStatusAsync(client, householdB));
    }

    [Fact]
    public async Task A_table_registered_later_is_purged_with_no_teardown_change()
    {
        using var factory = _factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.AddTableRepository<FakeEntity>("FakeTable")));
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var fakes = factory.Services.GetRequiredService<IEntityRepository<FakeEntity>>();
        await fakes.UpsertAsync(householdId, new FakeEntity { RowKey = "late", Payload = "x" });

        using var response = await TearDownAsync(client, householdId);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await fakes.ListAsync(householdId));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"confirmName\":\"\"}")]
    [InlineData("{\"confirmName\":\"   \"}")]
    [InlineData("{\"confirmName\":\"home\"}")]
    [InlineData("{\"confirmName\":\"Home \"}")]
    [InlineData("")]
    [InlineData(null)]
    public async Task A_missing_or_inexact_confirmName_is_400_and_deletes_nothing(string? json)
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var before = await CountAllAsync(_factory.Services, householdId);

        using var request = DeleteRequest(householdId, json);
        using var response = await client.SendAsync(request);

        await AssertProblemAsync(response, HttpStatusCode.BadRequest);
        Assert.Equal(HttpStatusCode.OK, await GetHouseholdStatusAsync(client, householdId));
        Assert.Equal(before, await CountAllAsync(_factory.Services, householdId));
    }

    [Fact]
    public async Task An_inexact_confirmName_is_a_name_mismatch_problem()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var request = DeleteRequest(householdId, ConfirmBody("HOME"));
        using var response = await client.SendAsync(request);

        await AssertProblemAsync(response, HttpStatusCode.BadRequest);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("Household name does not match.", doc.RootElement.GetProperty("title").GetString());
    }

    [Fact]
    public async Task An_unknown_household_is_404_problem_and_deletes_nothing()
    {
        using var client = _factory.CreateClient();
        var other = await CreateHouseholdAsync(client);
        var before = await CountAllAsync(_factory.Services, other);

        using var response = await TearDownAsync(client, Guid.NewGuid().ToString("N"));

        await AssertProblemAsync(response, HttpStatusCode.NotFound);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("Household not found.", doc.RootElement.GetProperty("title").GetString());
        Assert.Equal(before, await CountAllAsync(_factory.Services, other));
    }

    [Fact]
    public async Task A_participant_session_is_403_and_deletes_nothing()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var before = await CountAllAsync(_factory.Services, householdId);

        using var request = DeleteRequest(householdId, ConfirmBody(HouseholdName));
        request.Headers.TryAddWithoutValidation(
            ParticipantSession.HeaderName,
            ParticipantSession.Encode(householdId, Guid.NewGuid().ToString("N")));
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, await GetHouseholdStatusAsync(client, householdId));
        Assert.Equal(before, await CountAllAsync(_factory.Services, householdId));
    }

    [Fact]
    public async Task A_hub_device_token_is_403_and_deletes_nothing()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var deviceToken = await PairDeviceAsync(client, householdId);
        var before = await CountAllAsync(_factory.Services, householdId);

        using var request = DeleteRequest(householdId, ConfirmBody(HouseholdName));
        request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, deviceToken);
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, await GetHouseholdStatusAsync(client, householdId));
        Assert.Equal(before, await CountAllAsync(_factory.Services, householdId));
    }

    [Fact]
    public async Task A_torn_down_households_hub_device_token_is_401()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var deviceToken = await PairDeviceAsync(client, householdId);

        async Task<HttpStatusCode> GetAsDeviceAsync()
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, HouseholdRoute(householdId));
            request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, deviceToken);
            using var response = await client.SendAsync(request);
            return response.StatusCode;
        }

        Assert.Equal(HttpStatusCode.OK, await GetAsDeviceAsync());

        using var teardown = await TearDownAsync(client, householdId);
        Assert.Equal(HttpStatusCode.NoContent, teardown.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, await GetAsDeviceAsync());
    }

    [Fact]
    public async Task A_torn_down_households_participant_session_is_401()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var session = ParticipantSession.Encode(householdId, Guid.NewGuid().ToString("N"));

        async Task<HttpStatusCode> GlanceAsParticipantAsync()
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, EventsRoute(householdId))
            {
                Content = JsonContent.Create(new { type = "hub-glanced" }),
            };
            request.Headers.TryAddWithoutValidation(ParticipantSession.HeaderName, session);
            using var response = await client.SendAsync(request);
            return response.StatusCode;
        }

        Assert.Equal(HttpStatusCode.NoContent, await GlanceAsParticipantAsync());

        using var teardown = await TearDownAsync(client, householdId);
        Assert.Equal(HttpStatusCode.NoContent, teardown.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, await GlanceAsParticipantAsync());
    }

    [Fact]
    public async Task A_participant_session_for_a_missing_household_authenticates_nobody()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");

        using var request = new HttpRequestMessage(HttpMethod.Post, EventsRoute(householdId))
        {
            Content = JsonContent.Create(new { type = "hub-glanced" }),
        };
        request.Headers.TryAddWithoutValidation(
            ParticipantSession.HeaderName,
            ParticipantSession.Encode(householdId, Guid.NewGuid().ToString("N")));
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
