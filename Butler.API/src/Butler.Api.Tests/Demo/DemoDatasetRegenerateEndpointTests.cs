using System.Net;
using System.Reflection;
using System.Text.Json;
using Butler.Api.Application.System;
using Butler.Api.Controllers;
using Butler.Api.Infrastructure.Hosting;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Tests.Demo;

/// <summary>
/// Criteria (#99 AC3-AC5, AC9): an organizer's <c>POST /demo/dataset/regenerate</c>
/// in Development or Demo stores a new dataset id and returns it (<c>200</c>); a
/// non-organizer is forbidden (<c>403</c>); outside Development and Demo the
/// route is not mapped (<c>404</c>, like <c>POST /demo/seed</c>). The last two
/// leave the stored id unchanged.
/// </summary>
public sealed class DemoDatasetRegenerateEndpointTests
{
    private static readonly Uri RegenerateUri = new("/demo/dataset/regenerate", UriKind.Relative);

    // Turns real (JWT) authentication on, which every non-demo environment requires.
    private static void EnableAuthentication(IWebHostBuilder builder)
    {
        builder.UseSetting("Authentication:DisableAuthentication", "false");
        builder.UseSetting(
            "Authentication:Authority",
            "https://login.example.com/00000000-0000-0000-0000-000000000000/v2.0");
        builder.UseSetting("Authentication:Audience", "api://butler-test");
    }

    private static void UseMidJulyClock(IWebHostBuilder builder) =>
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(new MutableClock(DemoTestHost.MidJuly));
        });

    // Development with the organizer bypass on.
    private static WebApplicationFactory<Program> CreateDevelopmentFactory() =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("Authentication:DisableAuthentication", "true");
            UseMidJulyClock(builder);
        });

    // Any environment with JWT authentication on and every request carrying an
    // organizer principal (stands in for a valid organizer token), so only the
    // Development/Demo guardrail can turn the request away.
    private static WebApplicationFactory<Program> CreateOrganizerFactory(string environment) =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            EnableAuthentication(builder);
            UseMidJulyClock(builder);
            builder.ConfigureTestServices(services =>
                services
                    .AddAuthentication(TestOrganizerAuthenticationHandler.SchemeName)
                    .AddScheme<AuthenticationSchemeOptions, TestOrganizerAuthenticationHandler>(
                        TestOrganizerAuthenticationHandler.SchemeName,
                        configureOptions: null));
        });

    private static Task<string> StoredDatasetIdAsync(WebApplicationFactory<Program> factory) =>
        factory.Services.GetRequiredService<IDatasetService>().GetOrCreateAsync();

    [Theory]
    [InlineData("Development")]
    [InlineData(ButlerEnvironments.Demo)]
    public async Task Post_demo_dataset_regenerate_with_an_organizer_returns_200_and_a_new_dataset_id(string environment)
    {
        var isDemo = environment == ButlerEnvironments.Demo;
        using var factory = isDemo
            ? PinSignIn.CreateDemoFactory(new MutableClock(DemoTestHost.MidJuly))
            : CreateDevelopmentFactory();
        using var client = factory.CreateClient();
        var before = await StoredDatasetIdAsync(factory);

        // Demo signs in through the PIN, exactly as demo restore does (#99 AC6b).
        using var response = isDemo
            ? await PinSignIn.SendWithBearerAsync(client, HttpMethod.Post, RegenerateUri, await PinSignIn.TokenAsync(client))
            : await client.PostAsync(RegenerateUri, content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var returned = doc.RootElement.GetProperty("datasetId").GetString();
        Assert.False(string.IsNullOrEmpty(returned));
        Assert.NotEqual(before, returned);
        Assert.Equal(returned, await StoredDatasetIdAsync(factory));
    }

    [Fact]
    public async Task Post_demo_dataset_regenerate_is_forbidden_for_a_non_organizer()
    {
        using var factory = new ButlerApiFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
                services
                    .AddAuthentication(NonOrganizerAuthenticationHandler.SchemeName)
                    .AddScheme<AuthenticationSchemeOptions, NonOrganizerAuthenticationHandler>(
                        NonOrganizerAuthenticationHandler.SchemeName,
                        configureOptions: null)));
        using var client = factory.CreateClient();
        var before = await StoredDatasetIdAsync(factory);

        using var response = await client.PostAsync(RegenerateUri, content: null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(before, await StoredDatasetIdAsync(factory));
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public async Task Post_demo_dataset_regenerate_returns_404_outside_Development_or_Demo(string environment)
    {
        // The action exists (so the 404 below comes from the Development/Demo
        // guardrail, not from a missing endpoint).
        Assert.Contains(
            typeof(DemoController).GetMethods(),
            method => method.GetCustomAttribute<HttpPostAttribute>()?.Template == "dataset/regenerate");

        using var factory = CreateOrganizerFactory(environment);
        using var client = factory.CreateClient();
        var before = await StoredDatasetIdAsync(factory);

        using var response = await client.PostAsync(RegenerateUri, content: null);

        // The plain 404 of an unmapped route, as for POST /demo/seed (#106).
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(before, await StoredDatasetIdAsync(factory));
    }
}
