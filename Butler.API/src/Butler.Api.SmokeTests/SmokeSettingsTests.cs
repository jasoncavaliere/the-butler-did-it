using System.Net;
using System.Text;

namespace Butler.Api.SmokeTests;

/// <summary>
/// Criterion (AC2a/AC2b): the suite sends its requests to
/// <c>BUTLER_SMOKE_BASE_URL</c> when it is set, and to the local dev URL when it
/// is not. Runs offline against an injected lookup - it never mutates the
/// process environment, because xUnit runs test classes in parallel.
/// </summary>
[Trait(SmokeCategories.Name, SmokeCategories.Settings)]
public sealed class SmokeSettingsTests
{
    [Fact]
    public void Base_url_comes_from_BUTLER_SMOKE_BASE_URL_when_set()
    {
        var settings = SmokeSettings.FromEnvironment(Lookup(
            (SmokeSettings.BaseUrlVariable, "https://butler-test.example.net")));

        Assert.Equal(new Uri("https://butler-test.example.net/"), settings.BaseUrl);
    }

    [Fact]
    public void Http_client_targets_the_configured_base_url()
    {
        var settings = SmokeSettings.FromEnvironment(Lookup(
            (SmokeSettings.BaseUrlVariable, "http://127.0.0.1:5108")));

        using var client = settings.CreateHttpClient();

        Assert.Equal(new Uri("http://127.0.0.1:5108/"), client.BaseAddress);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Base_url_defaults_to_local_dev_url_when_unset_or_blank(string? value)
    {
        var settings = SmokeSettings.FromEnvironment(Lookup((SmokeSettings.BaseUrlVariable, value)));

        Assert.Equal(new Uri(SmokeSettings.DefaultBaseUrl), settings.BaseUrl);
        Assert.Equal(new Uri("http://localhost:5099/"), settings.BaseUrl);
    }

    [Theory]
    [InlineData("localhost:5099")]
    [InlineData("/relative/path")]
    [InlineData("ftp://localhost:5099")]
    [InlineData("not a url")]
    public void Malformed_base_url_fails_fast(string value)
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => SmokeSettings.FromEnvironment(Lookup((SmokeSettings.BaseUrlVariable, value))));

        Assert.Contains(SmokeSettings.BaseUrlVariable, ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Storage_connection_string_comes_from_its_variable_when_set()
    {
        const string connection = "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;TableEndpoint=http://azurite:10002/devstoreaccount1;";

        var settings = SmokeSettings.FromEnvironment(Lookup(
            (SmokeSettings.StorageConnectionStringVariable, connection)));

        Assert.Equal(connection, settings.StorageConnectionString);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Storage_connection_string_defaults_to_azurite_when_unset_or_blank(string? value)
    {
        var settings = SmokeSettings.FromEnvironment(Lookup(
            (SmokeSettings.StorageConnectionStringVariable, value)));

        Assert.Equal("UseDevelopmentStorage=true", settings.StorageConnectionString);
    }

    [Fact]
    public void Organizer_pin_comes_from_BUTLER_SMOKE_ORGANIZER_PIN_when_set()
    {
        var settings = SmokeSettings.FromEnvironment(Lookup(
            (SmokeSettings.OrganizerPinVariable, " 4321 ")));

        Assert.Equal("BUTLER_SMOKE_ORGANIZER_PIN", SmokeSettings.OrganizerPinVariable);
        Assert.Equal("4321", settings.OrganizerPin);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Organizer_pin_is_null_when_unset_or_blank(string? value)
    {
        var settings = SmokeSettings.FromEnvironment(Lookup((SmokeSettings.OrganizerPinVariable, value)));

        Assert.Null(settings.OrganizerPin);
    }

    [Fact]
    public async Task Http_client_sends_no_authorization_header_without_an_organizer_pin()
    {
        var settings = SmokeSettings.FromEnvironment(Lookup(
            (SmokeSettings.BaseUrlVariable, "http://localhost:8080/api/")));
        var fake = new FakeApi();

        using (var client = settings.CreateHttpClient(fake))
        {
            using var response = await client.GetAsync(new Uri("health", UriKind.Relative));
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        var sent = Assert.Single(fake.Requests);
        Assert.Equal(new Uri("http://localhost:8080/api/health"), sent.Uri);
        Assert.Null(sent.Authorization);
    }

    [Fact]
    public void Http_client_with_an_organizer_pin_targets_the_configured_base_url()
    {
        var settings = SmokeSettings.FromEnvironment(Lookup(
            (SmokeSettings.BaseUrlVariable, "http://localhost:8080/api/"),
            (SmokeSettings.OrganizerPinVariable, "1234")));

        using var client = settings.CreateHttpClient();

        Assert.Equal(new Uri("http://localhost:8080/api/"), client.BaseAddress);
    }

    [Fact]
    public async Task Http_client_signs_in_once_and_sends_the_bearer_token_on_every_request()
    {
        var settings = SmokeSettings.FromEnvironment(Lookup(
            (SmokeSettings.BaseUrlVariable, "http://localhost:8080/api/"),
            (SmokeSettings.OrganizerPinVariable, "1234")));
        var fake = new FakeApi();

        // Two clients from one settings instance, as two test classes would
        // create, with requests in parallel: still one sign-in.
        using (var first = settings.CreateHttpClient(fake))
        using (var second = settings.CreateHttpClient(fake))
        {
            var sends = Enumerable.Range(0, 8)
                .Select(i => (i % 2 == 0 ? first : second).GetAsync(new Uri($"households/h/rooms/{i}", UriKind.Relative)));
            var responses = await Task.WhenAll(sends);
            foreach (var response in responses)
            {
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                response.Dispose();
            }

            using var last = await first.DeleteAsync(new Uri("households/h/rooms/9", UriKind.Relative));
        }

        Assert.Equal(1, fake.SignIns);
        var others = fake.Requests.Where(r => !r.IsSignIn).ToList();
        Assert.Equal(9, others.Count);
        Assert.All(others, r => Assert.Equal("Bearer " + FakeApi.Token, r.Authorization));
    }

    [Fact]
    public async Task Sign_in_posts_the_pin_to_auth_pin_sign_in_under_the_base_url()
    {
        var settings = SmokeSettings.FromEnvironment(Lookup(
            (SmokeSettings.BaseUrlVariable, "http://localhost:8080/api/"),
            (SmokeSettings.OrganizerPinVariable, "1234")));
        var fake = new FakeApi();

        using (var client = settings.CreateHttpClient(fake))
        {
            using var response = await client.GetAsync(new Uri("health", UriKind.Relative));
        }

        var signIn = fake.Requests[0];
        Assert.True(signIn.IsSignIn);
        Assert.Equal(HttpMethod.Post, signIn.Method);
        Assert.Equal(new Uri("http://localhost:8080/api/auth/pin/sign-in"), signIn.Uri);
        Assert.Null(signIn.Authorization);
        Assert.Equal("application/json", signIn.ContentType);
        Assert.Equal("{\"pin\":\"1234\"}", signIn.Body);
        Assert.Equal(new Uri("http://localhost:8080/api/health"), fake.Requests[1].Uri);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.NotFound)]
    public async Task Failed_sign_in_throws_naming_the_variable_and_never_the_pin(HttpStatusCode status)
    {
        var settings = SmokeSettings.FromEnvironment(Lookup(
            (SmokeSettings.BaseUrlVariable, "http://localhost:8080/api/"),
            (SmokeSettings.OrganizerPinVariable, "987654")));
        var fake = new FakeApi { SignInStatus = status };

        using var client = settings.CreateHttpClient(fake);
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => client.GetAsync(new Uri("health", UriKind.Relative)));

        Assert.Contains(SmokeSettings.OrganizerPinVariable, ex.Message, StringComparison.Ordinal);
        Assert.Contains("http://localhost:8080/api/auth/pin/sign-in", ex.Message, StringComparison.Ordinal);
        Assert.Contains(((int)status).ToString(System.Globalization.CultureInfo.InvariantCulture), ex.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("987654", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Failed_sign_in_is_not_retried_so_a_wrong_pin_costs_one_attempt()
    {
        var settings = SmokeSettings.FromEnvironment(Lookup(
            (SmokeSettings.OrganizerPinVariable, "1234")));
        var fake = new FakeApi { SignInStatus = HttpStatusCode.Unauthorized };

        using (var first = settings.CreateHttpClient(fake))
        using (var second = settings.CreateHttpClient(fake))
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => first.GetAsync(new Uri("health", UriKind.Relative)));
            await Assert.ThrowsAsync<InvalidOperationException>(() => second.GetAsync(new Uri("health", UriKind.Relative)));
        }

        Assert.Equal(1, fake.SignIns);
        Assert.All(fake.Requests, r => Assert.True(r.IsSignIn));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"token\":\"\"}")]
    [InlineData("{\"token\":42}")]
    [InlineData("[]")]
    [InlineData("not json")]
    public async Task Sign_in_without_a_token_throws_and_never_names_the_pin(string body)
    {
        var settings = SmokeSettings.FromEnvironment(Lookup(
            (SmokeSettings.OrganizerPinVariable, "555555")));
        var fake = new FakeApi { SignInBody = body };

        using var client = settings.CreateHttpClient(fake);
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => client.GetAsync(new Uri("health", UriKind.Relative)));

        Assert.Contains(SmokeSettings.OrganizerPinVariable, ex.Message, StringComparison.Ordinal);
        Assert.Contains("without a token", ex.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("555555", ex.Message, StringComparison.Ordinal);
    }

    private static Func<string, string?> Lookup(params (string Name, string? Value)[] variables)
    {
        var map = variables.ToDictionary(v => v.Name, v => v.Value, StringComparer.Ordinal);
        return name => map.TryGetValue(name, out var value) ? value : null;
    }

    /// <summary>A recorded request the fake API received.</summary>
    private sealed record SentRequest(
        HttpMethod Method, Uri? Uri, string? Authorization, string? ContentType, string? Body, bool IsSignIn);

    /// <summary>
    /// An in-memory API: <c>POST .../auth/pin/sign-in</c> answers
    /// <see cref="SignInStatus"/> with <see cref="SignInBody"/>; anything else is 200.
    /// </summary>
    private sealed class FakeApi : HttpMessageHandler
    {
        public const string Token = "fake-organizer-token";

        private readonly object _gate = new();
        private readonly List<SentRequest> _requests = [];

        public HttpStatusCode SignInStatus { get; init; } = HttpStatusCode.OK;

        public string SignInBody { get; init; } = "{\"token\":\"" + Token + "\",\"subject\":\"s\",\"name\":\"n\",\"idleTimeoutSeconds\":900}";

        public IReadOnlyList<SentRequest> Requests
        {
            get
            {
                lock (_gate)
                {
                    return [.. _requests];
                }
            }
        }

        public int SignIns => Requests.Count(r => r.IsSignIn);

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            var isSignIn = request.RequestUri is not null
                && request.RequestUri.AbsolutePath.EndsWith("/auth/pin/sign-in", StringComparison.Ordinal);
            lock (_gate)
            {
                _requests.Add(new SentRequest(
                    request.Method,
                    request.RequestUri,
                    request.Headers.Authorization?.ToString(),
                    request.Content?.Headers.ContentType?.MediaType,
                    body,
                    isSignIn));
            }

            if (isSignIn)
            {
                // Let parallel callers pile up behind the first sign-in.
                await Task.Delay(20, cancellationToken);
                return new HttpResponseMessage(SignInStatus)
                {
                    Content = new StringContent(SignInBody, Encoding.UTF8, "application/json"),
                };
            }

            return new HttpResponseMessage(HttpStatusCode.OK);
        }
    }
}
