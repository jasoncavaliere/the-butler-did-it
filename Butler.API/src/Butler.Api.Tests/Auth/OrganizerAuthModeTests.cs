using System.Net;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.Auth;
using Butler.Api.Infrastructure.Hosting;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using NSubstitute;
using ButlerAuthenticationOptions = Butler.Api.Application.Auth.AuthenticationOptions;

namespace Butler.Api.Tests.Auth;

/// <summary>
/// Criteria (#105 AC1-AC3, AC12, AC13): the organizer provider is chosen by
/// environment - the demo PIN in Demo, the dev bypass in Development, JWT bearer
/// (Entra) when authentication is enabled elsewhere - and the PIN provider
/// outside Development and Demo refuses to start, naming the setting.
/// </summary>
public sealed class OrganizerAuthModeTests
{
    private const string Authority = "https://login.example.com/00000000-0000-0000-0000-000000000000/v2.0";

    private static WebApplicationFactory<Program> CreateFactory(
        string environment,
        params (string Key, string Value)[] settings) =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }
        });

    private static (string, string)[] EntraSettings(params (string, string)[] extra) =>
    [
        ("Authentication:DisableAuthentication", "false"),
        ("Authentication:Authority", Authority),
        ("Authentication:Audience", "api://butler-test"),
        .. extra,
    ];

    private static async Task<bool> HasSchemeAsync(WebApplicationFactory<Program> factory, string scheme) =>
        await factory.Services.GetRequiredService<IAuthenticationSchemeProvider>().GetSchemeAsync(scheme) is not null;

    private static IHostEnvironment Environment(string name)
    {
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns(name);
        return environment;
    }

    [Fact]
    public async Task Demo_environment_uses_the_pin_provider()
    {
        using var factory = CreateFactory(ButlerEnvironments.Demo);
        using var client = factory.CreateClient();

        using var bare = await client.GetAsync(PinSignIn.MeUri);
        Assert.Equal(HttpStatusCode.Unauthorized, bare.StatusCode);

        var token = await PinSignIn.TokenAsync(client);
        using var me = await PinSignIn.GetWithBearerAsync(client, PinSignIn.MeUri, token);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        using var doc = JsonDocument.Parse(await me.Content.ReadAsStringAsync());
        Assert.Equal(OrganizerAuthorization.DevOrganizerSubject, doc.RootElement.GetProperty("subject").GetString());
        Assert.Equal(OrganizerAuthorization.PinOrganizerName, doc.RootElement.GetProperty("name").GetString());

        Assert.True(await HasSchemeAsync(factory, OrganizerAuthorization.PinScheme));
        Assert.False(await HasSchemeAsync(factory, OrganizerAuthorization.DevScheme));
        Assert.False(await HasSchemeAsync(factory, JwtBearerDefaults.AuthenticationScheme));
    }

    [Fact]
    public async Task Development_environment_keeps_the_dev_bypass()
    {
        using var factory = CreateFactory(Environments.Development);
        using var client = factory.CreateClient();

        using var me = await client.GetAsync(PinSignIn.MeUri);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        using var doc = JsonDocument.Parse(await me.Content.ReadAsStringAsync());
        Assert.Equal(OrganizerAuthorization.DevOrganizerName, doc.RootElement.GetProperty("name").GetString());

        using var signIn = await PinSignIn.SignInAsync(client, ButlerApiFactory.DemoPin);
        Assert.Equal(HttpStatusCode.NotFound, signIn.StatusCode);
        Assert.True(await HasSchemeAsync(factory, OrganizerAuthorization.DevScheme));
        Assert.False(await HasSchemeAsync(factory, OrganizerAuthorization.PinScheme));
    }

    [Fact]
    public async Task Production_with_authentication_enabled_uses_jwt_bearer()
    {
        using var factory = CreateFactory(Environments.Production, EntraSettings());
        using var client = factory.CreateClient();

        using var me = await client.GetAsync(PinSignIn.MeUri);
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);

        using var signIn = await PinSignIn.SignInAsync(client, ButlerApiFactory.DemoPin);
        Assert.Equal(HttpStatusCode.NotFound, signIn.StatusCode);
        Assert.True(await HasSchemeAsync(factory, JwtBearerDefaults.AuthenticationScheme));
        Assert.False(await HasSchemeAsync(factory, OrganizerAuthorization.PinScheme));
    }

    [Fact]
    public async Task Explicit_bypass_still_wins_in_Demo()
    {
        using var factory = CreateFactory(ButlerEnvironments.Demo, ("Authentication:DisableAuthentication", "true"));
        using var client = factory.CreateClient();

        using var me = await client.GetAsync(PinSignIn.MeUri);

        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.False(await HasSchemeAsync(factory, OrganizerAuthorization.PinScheme));
    }

    [Fact]
    public async Task Pin_provider_in_Development_uses_the_pin()
    {
        using var factory = CreateFactory(Environments.Development, ("Authentication:Provider", "pin"));
        using var client = factory.CreateClient();

        using var bare = await client.GetAsync(PinSignIn.MeUri);
        Assert.Equal(HttpStatusCode.Unauthorized, bare.StatusCode);

        var token = await PinSignIn.TokenAsync(client);
        using var me = await PinSignIn.GetWithBearerAsync(client, PinSignIn.MeUri, token);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public void Demo_appsettings_bind_the_pin_defaults()
    {
        using var factory = CreateFactory(ButlerEnvironments.Demo);

        var options = factory.Services.GetRequiredService<PinOrganizerOptions>();

        Assert.Equal(5, options.MaxFailedAttempts);
        Assert.Equal(TimeSpan.FromMinutes(1), options.LockoutDuration);
        Assert.Equal(TimeSpan.FromMinutes(15), options.IdleTimeout);
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public void Pin_provider_outside_Development_or_Demo_fails_startup_naming_the_setting(string environment)
    {
        using var factory = CreateFactory(environment, EntraSettings(("Authentication:Provider", "Pin")));

        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());

        Assert.Contains(ButlerAuthenticationOptions.ProviderKey, exception.Message, StringComparison.Ordinal);
        Assert.Contains(environment, exception.Message, StringComparison.Ordinal);
        Assert.Contains("fail closed", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Unknown_provider_fails_startup_naming_the_setting()
    {
        using var factory = CreateFactory(Environments.Production, EntraSettings(("Authentication:Provider", "Okta")));

        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());

        Assert.Contains(ButlerAuthenticationOptions.ProviderKey, exception.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("Authentication:Pin:MaxFailedAttempts", "0")]
    [InlineData("Authentication:Pin:LockoutDuration", "00:00:00")]
    [InlineData("Authentication:Pin:IdleTimeout", "-00:00:01")]
    public void Non_positive_pin_settings_fail_startup_naming_the_key(string key, string value)
    {
        using var factory = CreateFactory(ButlerEnvironments.Demo, (key, value));

        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());

        Assert.Contains(key, exception.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("Development", null, null, OrganizerAuthMode.DevBypass)]
    [InlineData("Development", "Entra", null, OrganizerAuthMode.DevBypass)]
    [InlineData("Development", "Pin", null, OrganizerAuthMode.Pin)]
    [InlineData("Development", "Pin", true, OrganizerAuthMode.DevBypass)]
    [InlineData("Development", null, false, OrganizerAuthMode.EntraJwt)]
    [InlineData("Demo", "Pin", null, OrganizerAuthMode.Pin)]
    [InlineData("Demo", "PIN", false, OrganizerAuthMode.Pin)]
    [InlineData("Demo", "Pin", true, OrganizerAuthMode.DevBypass)]
    [InlineData("Demo", null, null, OrganizerAuthMode.EntraJwt)]
    [InlineData("Production", null, null, OrganizerAuthMode.EntraJwt)]
    [InlineData("Production", "  ", false, OrganizerAuthMode.EntraJwt)]
    [InlineData("Production", "entra", null, OrganizerAuthMode.EntraJwt)]
    public void Resolver_picks_the_mode(string environment, string? provider, bool? explicitDisable, OrganizerAuthMode expected)
    {
        Assert.Equal(expected, OrganizerAuthModeResolver.Resolve(Environment(environment), provider, explicitDisable));
    }

    [Fact]
    public void Resolver_keeps_the_bypass_refusal_outside_Development_or_Demo()
    {
        var exception = Assert.Throws<InvalidOperationException>(
            () => OrganizerAuthModeResolver.Resolve(Environment("Production"), null, true));

        Assert.Contains("Authentication:DisableAuthentication", exception.Message, StringComparison.Ordinal);
        Assert.Contains("Development", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Resolver_checks_the_pin_provider_before_the_bypass()
    {
        var exception = Assert.Throws<InvalidOperationException>(
            () => OrganizerAuthModeResolver.Resolve(Environment("Staging"), "pin", true));

        Assert.Contains(ButlerAuthenticationOptions.ProviderKey, exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Resolver_rejects_a_null_environment()
    {
        Assert.Throws<ArgumentNullException>(() => OrganizerAuthModeResolver.Resolve(null!, null, null));
    }

    [Theory]
    [InlineData("1234")]
    [InlineData("98765")]
    [InlineData("000000")]
    public void Pin_validation_accepts_4_to_6_ascii_digits(string pin)
    {
        Assert.Equal(pin, OrganizerAuthModeResolver.ValidatePin(pin));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("123")]
    [InlineData("1234567")]
    [InlineData("12a4")]
    [InlineData("12 34")]
    [InlineData("١٢٣٤")]
    public void Pin_validation_rejects_anything_else_without_echoing_it(string? pin)
    {
        var exception = Assert.Throws<InvalidOperationException>(() => OrganizerAuthModeResolver.ValidatePin(pin));

        Assert.Contains(PinOrganizerOptions.PinConfigurationKey, exception.Message, StringComparison.Ordinal);
        if (!string.IsNullOrEmpty(pin))
        {
            Assert.DoesNotContain(pin, exception.Message, StringComparison.Ordinal);
        }
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("Basic abc", null)]
    [InlineData("Bearer ", null)]
    [InlineData("Bearer    ", null)]
    [InlineData("Bearer abc", "abc")]
    [InlineData("bearer  abc ", "abc")]
    public void Bearer_token_parsing(string? header, string? expected)
    {
        Assert.Equal(expected, PinOrganizerAuthenticationHandler.ReadBearerToken(header));
    }
}
