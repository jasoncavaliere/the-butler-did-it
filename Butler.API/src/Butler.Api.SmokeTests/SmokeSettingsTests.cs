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

    private static Func<string, string?> Lookup(params (string Name, string? Value)[] variables)
    {
        var map = variables.ToDictionary(v => v.Name, v => v.Value, StringComparer.Ordinal);
        return name => map.TryGetValue(name, out var value) ? value : null;
    }
}
