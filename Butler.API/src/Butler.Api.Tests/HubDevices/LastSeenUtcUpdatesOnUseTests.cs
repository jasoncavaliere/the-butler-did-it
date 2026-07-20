using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.HubDevices;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Tests.HubDevices;

/// <summary>
/// Criterion (T5): the paired device's <c>LastSeenUtc</c> refreshes whenever its
/// token is presented, and the value comes from the injected clock seam - never
/// <c>DateTime.Now</c>. A controllable clock is wired in place of the system
/// timer; advancing it between the pair and a subsequent token-carrying request
/// makes the difference observable on the persisted row.
/// </summary>
public sealed class LastSeenUtcUpdatesOnUseTests
{
    private static readonly DateTimeOffset PairedAt = new(2026, 7, 20, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset UsedAt = new(2026, 7, 20, 21, 15, 0, TimeSpan.Zero);

    [Fact]
    public async Task Last_seen_advances_to_the_clock_time_when_the_token_is_used()
    {
        var clock = new MutableClock(PairedAt);
        using var factory = new ButlerApiFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton<TimeProvider>(clock);
            }));
        using var client = factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");

        // Pair at PairedAt (dev organizer satisfies the Organizer policy).
        using var pairResponse = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/hub-devices/pair", UriKind.Relative),
            new { deviceName = "Kitchen hub" });
        var pairBody = await pairResponse.Content.ReadAsStringAsync();
        Assert.True(pairResponse.StatusCode == HttpStatusCode.OK, pairBody);
        using var pairDoc = JsonDocument.Parse(pairBody);
        var deviceId = pairDoc.RootElement.GetProperty("deviceId").GetString()!;
        var token = pairDoc.RootElement.GetProperty("token").GetString()!;

        var repository = factory.Services.GetRequiredService<IHubDeviceRepository>();
        var afterPair = await repository.GetAsync(householdId, deviceId, CancellationToken.None);
        Assert.Equal(PairedAt, afterPair!.LastSeenUtc);

        // The clock advances, then the device uses its token on an open roster read.
        clock.Set(UsedAt);
        using var readRequest = new HttpRequestMessage(
            HttpMethod.Get,
            new Uri($"/households/{householdId}/people", UriKind.Relative));
        readRequest.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, token);
        using var readResponse = await client.SendAsync(readRequest);
        Assert.Equal(HttpStatusCode.OK, readResponse.StatusCode);

        // LastSeenUtc moved to the injected clock's new time; PairedUtc did not.
        var afterUse = await repository.GetAsync(householdId, deviceId, CancellationToken.None);
        Assert.Equal(UsedAt, afterUse!.LastSeenUtc);
        Assert.Equal(PairedAt, afterUse.PairedUtc);
    }
}
