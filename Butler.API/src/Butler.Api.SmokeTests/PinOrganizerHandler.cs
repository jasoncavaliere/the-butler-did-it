using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Butler.Api.SmokeTests;

/// <summary>
/// Signs the organizer in with the demo PIN (#103, #105) and sends the token as
/// a bearer on every request. The token comes from <c>POST auth/pin/sign-in</c>
/// under the base URL and is cached in an <see cref="OrganizerTokenCache"/>
/// shared by every client one <see cref="SmokeSettings"/> creates, so a run
/// signs in once. The token is never signed out: the API drops it after its
/// idle timeout.
/// </summary>
internal sealed class PinOrganizerHandler : DelegatingHandler
{
    /// <summary>The sign-in path, relative to the smoke base URL.</summary>
    internal const string SignInPath = "auth/pin/sign-in";

    private static readonly TimeSpan SignInTimeout = TimeSpan.FromSeconds(30);

    private readonly Uri _signInUri;
    private readonly string _pin;
    private readonly OrganizerTokenCache _cache;

    public PinOrganizerHandler(Uri baseUrl, string pin, OrganizerTokenCache cache, HttpMessageHandler innerHandler)
        : base(innerHandler)
    {
        ArgumentNullException.ThrowIfNull(baseUrl);
        ArgumentException.ThrowIfNullOrWhiteSpace(pin);
        ArgumentNullException.ThrowIfNull(cache);

        _signInUri = new Uri(baseUrl, SignInPath);
        _pin = pin;
        _cache = cache;
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var token = await _cache.GetOrSignIn(SignInAsync).ConfigureAwait(false);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await base.SendAsync(request, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Exchanges the PIN for a token. A failure names the URL, the status and
    /// <see cref="SmokeSettings.OrganizerPinVariable"/>, never the PIN.
    /// </summary>
    private async Task<string> SignInAsync()
    {
        using var timeout = new CancellationTokenSource(SignInTimeout);
        using var request = new HttpRequestMessage(HttpMethod.Post, _signInUri)
        {
            Content = JsonContent.Create(new { pin = _pin }),
        };
        using var response = await base.SendAsync(request, timeout.Token).ConfigureAwait(false);

        if (response.StatusCode != HttpStatusCode.OK)
        {
            throw new InvalidOperationException(
                $"Organizer PIN sign-in at {_signInUri} returned {(int)response.StatusCode} {response.StatusCode}. "
                + $"Check that {SmokeSettings.OrganizerPinVariable} matches the API's BUTLER_DEMO_PIN.");
        }

        var body = await response.Content.ReadAsStringAsync(timeout.Token).ConfigureAwait(false);
        string? token = null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty("token", out var value)
                && value.ValueKind == JsonValueKind.String)
            {
                token = value.GetString();
            }
        }
        catch (JsonException)
        {
            token = null;
        }

        if (string.IsNullOrWhiteSpace(token))
        {
            throw new InvalidOperationException(
                $"Organizer PIN sign-in at {_signInUri} returned 200 without a token "
                + $"(signed in with {SmokeSettings.OrganizerPinVariable}).");
        }

        return token;
    }
}

/// <summary>
/// The one organizer sign-in of a <see cref="SmokeSettings"/> instance. The
/// first caller starts it; every caller, including concurrent ones, awaits the
/// same task. A failed sign-in is cached too, so a wrong PIN costs one attempt,
/// not one per test (five wrong PINs lock sign-in, #105).
/// </summary>
internal sealed class OrganizerTokenCache
{
    private readonly object _gate = new();
    private Task<string>? _token;

    /// <summary>Returns the cached sign-in, starting it with <paramref name="signIn"/> on first use.</summary>
    /// <param name="signIn">Signs in and returns the token.</param>
    public Task<string> GetOrSignIn(Func<Task<string>> signIn)
    {
        ArgumentNullException.ThrowIfNull(signIn);

        lock (_gate)
        {
            return _token ??= signIn();
        }
    }
}
