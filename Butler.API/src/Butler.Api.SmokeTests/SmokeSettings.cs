namespace Butler.Api.SmokeTests;

/// <summary>
/// Where the smoke suite points. Resolved from environment variables so the same
/// build runs locally (defaults) and against a booted or deployed API (CI, or
/// <c>dotnet test -e BUTLER_SMOKE_BASE_URL=...</c>). The lookup is injected so
/// the resolution rules are testable without mutating process state.
/// </summary>
public sealed class SmokeSettings
{
    /// <summary>Environment variable that overrides the API base URL.</summary>
    public const string BaseUrlVariable = "BUTLER_SMOKE_BASE_URL";

    /// <summary>Environment variable that overrides the Table Storage connection string.</summary>
    public const string StorageConnectionStringVariable = "BUTLER_SMOKE_STORAGE_CONNECTION_STRING";

    /// <summary>
    /// The local dev URL: the <c>http</c> launch profile used by
    /// <c>dotnet run --project src/Butler.Api</c> and <c>Start-LocalSession.ps1</c>.
    /// </summary>
    public const string DefaultBaseUrl = "http://localhost:5099";

    /// <summary>Azurite's well-known development-storage connection string.</summary>
    public const string DefaultStorageConnectionString = "UseDevelopmentStorage=true";

    private SmokeSettings(Uri baseUrl, string storageConnectionString)
    {
        BaseUrl = baseUrl;
        StorageConnectionString = storageConnectionString;
    }

    /// <summary>The API every liveness request is sent to.</summary>
    public Uri BaseUrl { get; }

    /// <summary>The Table Storage backend the storage round trips run against.</summary>
    public string StorageConnectionString { get; }

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

        return new SmokeSettings(baseUrl, connection);
    }

    /// <summary>Creates an <see cref="HttpClient"/> whose base address is <see cref="BaseUrl"/>.</summary>
    public HttpClient CreateHttpClient() => new() { BaseAddress = BaseUrl };

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
