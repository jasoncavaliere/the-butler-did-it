using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Households;

/// <summary>
/// Criteria (#105 AC22): <c>GET /households/{householdId}</c> carries the
/// <c>OrganizerOrHubDevice</c> policy, so a paired hub device reads its
/// household while a participant session is forbidden; <c>POST /households</c>
/// stays organizer-only. The default factory runs in Development, so the ambient
/// caller is the dev organizer.
/// </summary>
public sealed class GetHouseholdHubDeviceTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public GetHouseholdHubDeviceTests(ButlerApiFactory factory)
    {
        ArgumentNullException.ThrowIfNull(factory);
        _factory = factory;
    }

    private static async Task<(string HouseholdId, string DeviceToken)> CreatePairedHouseholdAsync(HttpClient client)
    {
        using var create = await client.PostAsJsonAsync(new Uri("/households", UriKind.Relative), new { name = "Home" });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        using var createDoc = JsonDocument.Parse(await create.Content.ReadAsStringAsync());
        var householdId = createDoc.RootElement.GetProperty("householdId").GetString()!;

        using var pair = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/hub-devices/pair", UriKind.Relative),
            new { deviceName = "Kitchen hub" });
        Assert.Equal(HttpStatusCode.OK, pair.StatusCode);
        using var pairDoc = JsonDocument.Parse(await pair.Content.ReadAsStringAsync());
        return (householdId, pairDoc.RootElement.GetProperty("token").GetString()!);
    }

    [Fact]
    public async Task A_paired_hub_device_reads_the_household()
    {
        using var client = _factory.CreateClient();
        var (householdId, deviceToken) = await CreatePairedHouseholdAsync(client);

        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri($"/households/{householdId}", UriKind.Relative));
        request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, deviceToken);
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(householdId, doc.RootElement.GetProperty("householdId").GetString());
    }

    [Fact]
    public async Task A_participant_session_cannot_read_the_household()
    {
        using var client = _factory.CreateClient();
        var (householdId, _) = await CreatePairedHouseholdAsync(client);

        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri($"/households/{householdId}", UriKind.Relative));
        request.Headers.TryAddWithoutValidation(
            ParticipantSession.HeaderName,
            ParticipantSession.Encode(householdId, Guid.NewGuid().ToString("N")));
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_paired_hub_device_cannot_create_a_household()
    {
        using var client = _factory.CreateClient();
        var (_, deviceToken) = await CreatePairedHouseholdAsync(client);

        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri("/households", UriKind.Relative))
        {
            Content = JsonContent.Create(new { name = "Other" }),
        };
        request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, deviceToken);
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
