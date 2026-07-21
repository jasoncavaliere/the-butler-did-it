using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.HubDevices;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Butler.Api.Tests.HubDevices;

/// <summary>
/// Criteria (T5): pairing a hub device is a sensitive action gated by the
/// <c>Organizer</c> policy. A participant session is authenticated-but-forbidden
/// (<c>403</c>), an anonymous caller is challenged (<c>401</c>), and only a
/// signed-in organizer - the dev organizer in dev mode - can pair, which writes
/// the <c>HubDevices</c> row and returns a household-scoped token.
/// </summary>
public sealed class PairRequiresOrganizerTests
{
    private static Uri PairUri(string householdId) =>
        new($"/households/{householdId}/hub-devices/pair", UriKind.Relative);

    private static WebApplicationFactory<Program> CreateAuthEnabledFactory()
    {
        return new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(Environments.Production);
            builder.UseSetting("Authentication:DisableAuthentication", "false");
            builder.UseSetting(
                "Authentication:Authority",
                "https://login.example.com/00000000-0000-0000-0000-000000000000/v2.0");
            builder.UseSetting("Authentication:Audience", "api://butler-test");
        });
    }

    [Fact]
    public async Task A_participant_session_is_forbidden_from_pairing()
    {
        using var factory = CreateAuthEnabledFactory();
        using var client = factory.CreateClient();

        var participantToken = ParticipantSession.Encode(
            Guid.NewGuid().ToString("N"),
            Guid.NewGuid().ToString("N"));

        using var request = new HttpRequestMessage(HttpMethod.Post, PairUri(Guid.NewGuid().ToString("N")))
        {
            Content = JsonContent.Create(new { deviceName = "Kitchen hub" }),
        };
        request.Headers.TryAddWithoutValidation(ParticipantSession.HeaderName, participantToken);
        using var response = await client.SendAsync(request);

        // Authenticated (so not a 401 challenge) but lacking the organizer role.
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_anonymous_caller_is_challenged_and_cannot_pair()
    {
        using var factory = CreateAuthEnabledFactory();
        using var client = factory.CreateClient();

        using var response = await client.PostAsJsonAsync(
            PairUri(Guid.NewGuid().ToString("N")),
            new { deviceName = "Kitchen hub" });

        // No credentials -> the policy's RequireAuthenticatedUser challenges (401).
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task The_dev_organizer_can_pair_which_writes_a_row_and_returns_a_scoped_token()
    {
        using var factory = new ButlerApiFactory();
        using var client = factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");

        using var response = await client.PostAsJsonAsync(
            PairUri(householdId),
            new { deviceName = "Kitchen hub" });

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        Assert.Equal(householdId, root.GetProperty("householdId").GetString());
        var deviceId = root.GetProperty("deviceId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(deviceId));
        Assert.Equal("Kitchen hub", root.GetProperty("deviceName").GetString());

        // The returned token decodes to exactly the paired scope.
        var token = root.GetProperty("token").GetString();
        Assert.True(DeviceToken.TryDecode(token, out var scopedHousehold, out var scopedDevice));
        Assert.Equal(householdId, scopedHousehold);
        Assert.Equal(deviceId, scopedDevice);

        // The HubDevices row was persisted in the household partition.
        var repository = factory.Services.GetRequiredService<IHubDeviceRepository>();
        var stored = await repository.GetAsync(householdId, deviceId!, CancellationToken.None);
        Assert.NotNull(stored);
        Assert.Equal("Kitchen hub", stored!.DeviceName);
        Assert.NotEqual(default, stored.PairedUtc);
        Assert.NotEqual(default, stored.LastSeenUtc);
    }

    [Fact]
    public async Task Pairing_rejects_a_blank_device_name()
    {
        using var factory = new ButlerApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.PostAsJsonAsync(
            PairUri(Guid.NewGuid().ToString("N")),
            new { deviceName = "" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
