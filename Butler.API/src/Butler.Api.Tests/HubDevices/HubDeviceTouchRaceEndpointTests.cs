using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.HubDevices;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Tests.HubDevices;

/// <summary>
/// Criterion (#222): a hub token whose device row is deleted while its touch is in
/// flight (for example by household teardown purging the <c>HubDevices</c>
/// partition) is rejected, and the touch does not re-create the row, so the token
/// stays rejected. A <see cref="RacingHubDeviceRepository"/> replaces the
/// production repository to land the delete between the touch's read and write.
/// </summary>
/// <remarks>
/// The probe is <c>GET /households/{householdId}</c>, which requires an organizer
/// or a hub device, so a rejected token surfaces as <c>401</c> (the roster read is
/// open to anonymous callers and would mask it).
/// </remarks>
public sealed class HubDeviceTouchRaceEndpointTests
{
    [Fact]
    public async Task A_token_whose_row_is_deleted_during_its_touch_is_401_and_stays_401()
    {
        using var factory = new ButlerApiFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IHubDeviceRepository>();
                services.AddSingleton<IHubDeviceRepository>(sp =>
                {
                    var entities = sp.GetRequiredService<IEntityRepository<HubDeviceEntity>>();
                    return new RacingHubDeviceRepository(new TableHubDeviceRepository(entities), entities);
                });
            }));
        using var client = factory.CreateClient();

        // Create the household so the probe read has something to return.
        using var createResponse = await client.PostAsJsonAsync(
            new Uri("/households", UriKind.Relative),
            new { name = "Race household" });
        var createBody = await createResponse.Content.ReadAsStringAsync();
        Assert.True(createResponse.StatusCode == HttpStatusCode.Created, createBody);
        using var createDoc = JsonDocument.Parse(createBody);
        var householdId = createDoc.RootElement.GetProperty("householdId").GetString()!;

        // Pair (dev organizer satisfies the Organizer policy); pairing never reads.
        using var pairResponse = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/hub-devices/pair", UriKind.Relative),
            new { deviceName = "Kitchen hub" });
        var pairBody = await pairResponse.Content.ReadAsStringAsync();
        Assert.True(pairResponse.StatusCode == HttpStatusCode.OK, pairBody);
        using var pairDoc = JsonDocument.Parse(pairBody);
        var deviceId = pairDoc.RootElement.GetProperty("deviceId").GetString()!;
        var token = pairDoc.RootElement.GetProperty("token").GetString()!;

        // Sanity: before the race is armed, the token authenticates.
        Assert.Equal(HttpStatusCode.OK, await ReadHouseholdAsync(client, householdId, token));

        // The purge lands between the next touch's read and its write.
        var racing = (RacingHubDeviceRepository)factory.Services.GetRequiredService<IHubDeviceRepository>();
        racing.DeleteAfterNextRead = true;
        Assert.Equal(HttpStatusCode.Unauthorized, await ReadHouseholdAsync(client, householdId, token));

        // The touch did not re-create the row, so the token stays rejected.
        var entities = factory.Services.GetRequiredService<IEntityRepository<HubDeviceEntity>>();
        Assert.Null(await entities.GetAsync(householdId, deviceId, CancellationToken.None));
        Assert.Equal(HttpStatusCode.Unauthorized, await ReadHouseholdAsync(client, householdId, token));
    }

    private static async Task<HttpStatusCode> ReadHouseholdAsync(HttpClient client, string householdId, string token)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            new Uri($"/households/{householdId}", UriKind.Relative));
        request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, token);
        using var response = await client.SendAsync(request);
        return response.StatusCode;
    }
}
