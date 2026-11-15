namespace Butler.Api.SmokeTests;

/// <summary>
/// Where the smoke suite points. Resolved from environment variables so the same
/// build runs locally (defaults) and against a booted or deployed API (CI, or
/// <c>dotnet test -e BUTLER_SMOKE_BASE_URL=...</c>). The lookup is injected so
/// the resolution rules are testable without mutating process state.
/// </summary>
/// <remarks>
/// <c>BUTLER_SMOKE_ORGANIZER_PIN</c> is opt-in (#103): when it is set, every
/// <see cref="HttpClient"/> from <see cref="CreateHttpClient()"/> signs the
/// organizer in with that PIN (<c>POST auth/pin/sign-in</c>, once per settings
/// instance) and sends the token as a bearer, so the Endpoints tests run against
/// an API whose organizer signs in with a PIN (the Demo stack, #105) instead of
/// the Development bypass. Unset, the client sends no Authorization header.
/// </remarks>
public sealed class SmokeSettings
{
    /// <summary>Environment variable that overrides the API base URL.</summary>
    public const string BaseUrlVariable = "BUTLER_SMOKE_BASE_URL";

    /// <summary>Environment variable that overrides the Table Storage connection string.</summary>
    public const string StorageConnectionStringVariable = "BUTLER_SMOKE_STORAGE_CONNECTION_STRING";

    /// <summary>
    /// Environment variable holding the organizer PIN the HTTP clients sign in
    /// with (#103). It must match the API's <c>BUTLER_DEMO_PIN</c>.
    /// </summary>
    public const string OrganizerPinVariable = "BUTLER_SMOKE_ORGANIZER_PIN";

    /// <summary>
    /// The local dev URL: the <c>http</c> launch profile used by
    /// <c>dotnet run --project src/Butler.Api</c> and <c>Start-LocalSession.ps1</c>.
    /// </summary>
    public const string DefaultBaseUrl = "http://localhost:5099";

    /// <summary>Azurite's well-known development-storage connection string.</summary>
    public const string DefaultStorageConnectionString = "UseDevelopmentStorage=true";

    /// <summary>One organizer sign-in per settings instance, shared by every client it creates.</summary>
    private readonly OrganizerTokenCache _organizerToken = new();

    private SmokeSettings(Uri baseUrl, string storageConnectionString, string? organizerPin)
    {
        BaseUrl = baseUrl;
        StorageConnectionString = storageConnectionString;
        OrganizerPin = organizerPin;
    }

    /// <summary>The API every liveness request is sent to.</summary>
    public Uri BaseUrl { get; }

    /// <summary>The Table Storage backend the storage round trips run against.</summary>
    public string StorageConnectionString { get; }

    /// <summary>
    /// The organizer PIN the HTTP clients sign in with, or <see langword="null"/>
    /// when <see cref="OrganizerPinVariable"/> is unset or blank (no sign-in).
    /// </summary>
    public string? OrganizerPin { get; }

    /// <summary>Settings resolved from the real process environment.</summary>
    public static SmokeSettings Current { get; } = FromEnvironment(Environment.GetEnvironmentVariable);

    /// <summary>
    /// Resolves settings through <paramref name="getVariable"/>. An unset or blank
    /// variable falls back to its default; a base URL that is set but is not an
    /// absolute http(s) URL fails fast rather than silently probing the wrong host.
    /// </summary>
    /// <param name="getVariable">Looks up an environment variable by name.</param>
    /// <exception cref="InvalidOperationException">The base URL is malformed.</exception>
    public static SmokeSettings FromEnvironment(Func<string, string?> getVariable)
    {
        ArgumentNullException.ThrowIfNull(getVariable);

        var rawBaseUrl = getVariable(BaseUrlVariable);
        var baseUrl = string.IsNullOrWhiteSpace(rawBaseUrl)
            ? new Uri(DefaultBaseUrl, UriKind.Absolute)
            : ParseBaseUrl(rawBaseUrl.Trim());

        var rawConnection = getVariable(StorageConnectionStringVariable);
        var connection = string.IsNullOrWhiteSpace(rawConnection)
            ? DefaultStorageConnectionString
            : rawConnection.Trim();

        var rawPin = getVariable(OrganizerPinVariable);
        var pin = string.IsNullOrWhiteSpace(rawPin) ? null : rawPin.Trim();

        return new SmokeSettings(baseUrl, connection, pin);
    }

    /// <summary>
    /// Creates an <see cref="HttpClient"/> whose base address is <see cref="BaseUrl"/>.
    /// With an <see cref="OrganizerPin"/>, its requests carry the organizer's bearer token.
    /// </summary>
    public HttpClient CreateHttpClient() =>
        OrganizerPin is null ? new() { BaseAddress = BaseUrl } : CreateHttpClient(new HttpClientHandler());

    /// <summary>
    /// Creates an <see cref="HttpClient"/> over <paramref name="inner"/>, which it
    /// owns and disposes; the seam the offline tests send through.
    /// </summary>
    /// <param name="inner">The handler that sends the requests.</param>
    internal HttpClient CreateHttpClient(HttpMessageHandler inner)
    {
        ArgumentNullException.ThrowIfNull(inner);

        var handler = OrganizerPin is null
            ? inner
            : new PinOrganizerHandler(BaseUrl, OrganizerPin, _organizerToken, inner);
        return new HttpClient(handler, disposeHandler: true) { BaseAddress = BaseUrl };
    }

    private static Uri ParseBaseUrl(string value)
    {
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
        {
            return uri;
        }

        throw new InvalidOperationException(
            $"{BaseUrlVariable} must be an absolute http(s) URL such as {DefaultBaseUrl}; got '{value}'.");
    }
}
