using System.Net;
using System.Text.Json;
using Azure.Data.Tables;
using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.Hosting;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using NSubstitute;

namespace Butler.Api.Tests.Hosting;

/// <summary>
/// Criteria (#95): the API boots in the <c>Demo</c> environment the container
/// image defaults to - it loads <c>appsettings.Demo.json</c>, serves
/// <c>/health</c> and Swagger, signs the organizer in with the demo PIN (#105)
/// as the dev-organizer subject the demo seed binds, binds the storage connection string from configuration
/// (<c>Storage__ConnectionString</c>), and still fails closed when Entra is
/// selected without an authority. Swagger stays off outside Development and Demo.
/// </summary>
public sealed class DemoEnvironmentTests
{
    /// <summary>A placeholder that is never parsed: the table client factory is substituted.</summary>
    private const string PlaceholderConnection = "placeholder-not-a-real-connection";

    /// <summary>
    /// Composes the real app in the given environment with any extra settings
    /// for the scenario.
    /// </summary>
    private static WebApplicationFactory<Program> CreateFactory(
        string environment,
        Action<IWebHostBuilder>? configure = null)
    {
        return new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            configure?.Invoke(builder);
        });
    }

    [Fact]
    public async Task Demo_environment_boots_and_serves_health_200()
    {
        using var factory = CreateFactory(ButlerEnvironments.Demo);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(new Uri("/health", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("ok", doc.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public void Demo_environment_loads_appsettings_Demo_json()
    {
        using var factory = CreateFactory(ButlerEnvironments.Demo);

        var environment = factory.Services.GetRequiredService<IHostEnvironment>();
        var configuration = factory.Services.GetRequiredService<IConfiguration>();

        Assert.Equal(ButlerEnvironments.Demo, environment.EnvironmentName);
        // appsettings.Demo.json selects the PIN organizer (#105) and no longer
        // sets the bypass.
        Assert.Equal("Pin", configuration["Authentication:Provider"]);
        Assert.Null(configuration["Authentication:DisableAuthentication"]);
    }

    [Theory]
    [InlineData("/swagger/v1/swagger.json")]
    [InlineData("/swagger/index.html")]
    public async Task Demo_environment_serves_swagger(string path)
    {
        using var factory = CreateFactory(ButlerEnvironments.Demo);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(new Uri(path, UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Demo_environment_signs_in_the_dev_organizer_subject_with_the_pin()
    {
        using var factory = CreateFactory(ButlerEnvironments.Demo);
        using var client = factory.CreateClient();
        var token = await PinSignIn.TokenAsync(client);

        using var response = await PinSignIn.GetWithBearerAsync(client, PinSignIn.MeUri, token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal(
            OrganizerAuthorization.DevOrganizerSubject,
            doc.RootElement.GetProperty("subject").GetString());
    }

    [Fact]
    public void Demo_environment_binds_the_storage_connection_string_from_configuration()
    {
        // Storage:ConnectionString is what the Storage__ConnectionString
        // environment variable maps to through the default configuration providers.
        using var factory = CreateFactory(ButlerEnvironments.Demo, builder =>
        {
            builder.UseSetting("Storage:ConnectionString", PlaceholderConnection);

            // Table mode now provisions the registered tables at startup (#91);
            // substitute the client factory so the placeholder is never parsed.
            builder.ConfigureTestServices(services =>
            {
                var tables = Substitute.For<ITableClientFactory>();
                tables.GetTableClient(Arg.Any<string>()).Returns(_ => Substitute.For<TableClient>());
                services.RemoveAll<ITableClientFactory>();
                services.AddSingleton(tables);
            });
        });

        // Resolve the options only - never a repository, which would need a real
        // table client.
        var storage = factory.Services.GetRequiredService<IOptions<StorageOptions>>().Value;

        Assert.Equal(PlaceholderConnection, storage.ConnectionString);
        Assert.False(storage.ResolveUseInMemory());
    }

    [Fact]
    public void Demo_environment_fails_closed_when_Entra_is_selected_without_an_authority()
    {
        using var factory = CreateFactory(ButlerEnvironments.Demo, builder =>
        {
            builder.UseSetting("Authentication:DisableAuthentication", "false");
            builder.UseSetting("Authentication:Provider", "Entra");
            builder.UseSetting("Authentication:Authority", string.Empty);
        });

        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());
        Assert.Contains("Authority", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Production_environment_does_not_serve_swagger()
    {
        using var factory = CreateFactory(Environments.Production, builder =>
        {
            builder.UseSetting("Authentication:DisableAuthentication", "false");
            builder.UseSetting(
                "Authentication:Authority",
                "https://login.example.com/00000000-0000-0000-0000-000000000000/v2.0");
            builder.UseSetting("Authentication:Audience", "api://butler-test");
        });
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(new Uri("/swagger/v1/swagger.json", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
