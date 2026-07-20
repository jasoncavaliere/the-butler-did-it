using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.HubDevices;

/// <summary>
/// Criterion (T5, mitigates BRD risk R-1): a hub device token is a broader
/// credential than a session but still carries no organizer authority. Presented
/// to an <c>Organizer</c>-policy endpoint it is authenticated-but-forbidden - a
/// hard <c>403</c>, never a <c>200</c>. A malformed token, or one for a device
/// that is no longer paired, authenticates nobody, so it is a <c>401</c>. The
/// boundary is structural: the token never holds the organizer role.
/// </summary>
public sealed class DeviceTokenCannotDoSensitiveActionTests : IClassFixture<ButlerApiFactory>
{
    // GET /me is the reference Organizer-policy endpoint (Engineering Contract 7.4).
    private static readonly Uri OrganizerEndpoint = new("/me", UriKind.Relative);

    private readonly ButlerApiFactory _factory;

    public DeviceTokenCannotDoSensitiveActionTests(ButlerApiFactory factory) => _factory = factory;

    private async Task<string> PairDeviceAsync(HttpClient client, string householdId)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/hub-devices/pair", UriKind.Relative),
            new { deviceName = "Kitchen hub" });
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("token").GetString()!;
    }

    [Fact]
    public async Task A_paired_device_token_is_forbidden_at_an_organizer_endpoint()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var token = await PairDeviceAsync(client, householdId);

        using var request = new HttpRequestMessage(HttpMethod.Get, OrganizerEndpoint);
        request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, token);
        using var response = await client.SendAsync(request);

        // Authenticated as a hub device (so not a 401 challenge) but not an organizer.
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_malformed_device_token_authenticates_nobody()
    {
        using var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Get, OrganizerEndpoint);
        request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, "not-a-real-token");
        using var response = await client.SendAsync(request);

        // No valid principal -> the policy's RequireAuthenticatedUser challenges (401).
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_token_for_an_unpaired_device_authenticates_nobody()
    {
        using var client = _factory.CreateClient();

        // Well-formed token, but no such device was ever paired.
        var token = DeviceToken.Encode(
            Guid.NewGuid().ToString("N"),
            Guid.NewGuid().ToString("N"));

        using var request = new HttpRequestMessage(HttpMethod.Get, OrganizerEndpoint);
        request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, token);
        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
