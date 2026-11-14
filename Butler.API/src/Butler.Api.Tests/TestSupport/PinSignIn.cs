using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Infrastructure.Hosting;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Tests.TestSupport;

/// <summary>
/// Helpers for the demo PIN organizer (#105): boot the API in the Demo
/// environment (PIN provider, <see cref="ButlerApiFactory.DemoPin"/>) with a
/// controllable clock, and sign in through <c>POST /auth/pin/sign-in</c>.
/// </summary>
public static class PinSignIn
{
    /// <summary>The sign-in endpoint.</summary>
    public static readonly Uri SignInUri = new("/auth/pin/sign-in", UriKind.Relative);

    /// <summary>The sign-out endpoint.</summary>
    public static readonly Uri SignOutUri = new("/auth/pin/sign-out", UriKind.Relative);

    /// <summary>The organizer-only probe endpoint.</summary>
    public static readonly Uri MeUri = new("/me", UriKind.Relative);

    /// <summary>
    /// A Demo-environment factory using <paramref name="clock"/> as the
    /// <see cref="TimeProvider"/>, with any extra configuration overrides.
    /// </summary>
    public static WebApplicationFactory<Program> CreateDemoFactory(
        TimeProvider clock,
        params (string Key, string Value)[] settings) =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(ButlerEnvironments.Demo);
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton(clock);
            });
        });

    /// <summary>Posts <paramref name="pin"/> to the sign-in endpoint.</summary>
    public static Task<HttpResponseMessage> SignInAsync(HttpClient client, string pin)
    {
        ArgumentNullException.ThrowIfNull(client);
        return client.PostAsJsonAsync(SignInUri, new { pin });
    }

    /// <summary>Signs in with <paramref name="pin"/> and returns the issued token (fails the test otherwise).</summary>
    public static async Task<string> TokenAsync(HttpClient client, string pin = ButlerApiFactory.DemoPin)
    {
        using var response = await SignInAsync(client, pin);
        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("token").GetString()!;
    }

    /// <summary>Sends a <c>GET</c> to <paramref name="uri"/> carrying <paramref name="token"/> as a bearer.</summary>
    public static Task<HttpResponseMessage> GetWithBearerAsync(HttpClient client, Uri uri, string token) =>
        SendWithBearerAsync(client, HttpMethod.Get, uri, token);

    /// <summary>Sends <paramref name="method"/> to <paramref name="uri"/> carrying <paramref name="token"/> as a bearer.</summary>
    public static async Task<HttpResponseMessage> SendWithBearerAsync(
        HttpClient client,
        HttpMethod method,
        Uri uri,
        string token,
        HttpContent? content = null)
    {
        ArgumentNullException.ThrowIfNull(client);
        using var request = new HttpRequestMessage(method, uri) { Content = content };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await client.SendAsync(request);
    }
}
