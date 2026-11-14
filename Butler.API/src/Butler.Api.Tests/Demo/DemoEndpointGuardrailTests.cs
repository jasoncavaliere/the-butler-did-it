using System.Net;
using Butler.Api.Application.Demo;
using Butler.Api.Controllers;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.Hosting;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace Butler.Api.Tests.Demo;

/// <summary>
/// Criteria (#106 AC2-AC5): <c>POST /demo/seed</c> exists only in Development
/// and Demo. There an organizer is served (<c>200</c>) and an unauthenticated
/// caller is challenged (<c>401</c>, unchanged). In every other environment the
/// demo endpoints are not mapped at all, so every caller - with or without an
/// organizer token - gets <c>404</c>, never <c>401</c> or <c>403</c>.
/// </summary>
public sealed class DemoEndpointGuardrailTests
{
    private static readonly Uri SeedUri = new("/demo/seed", UriKind.Relative);

    // Turns real (JWT) authentication on, which every non-demo environment
    // requires and which makes an anonymous caller challengeable in Dev/Demo.
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

    // Dev/Demo with the organizer bypass on (the default in Development; Demo
    // uses the PIN organizer, so the bypass is set explicitly there).
    private static WebApplicationFactory<Program> CreateBypassFactory(string environment) =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            builder.UseSetting("Authentication:DisableAuthentication", "true");
            UseMidJulyClock(builder);
        });

    // Any environment with JWT authentication on and no token presented.
    private static WebApplicationFactory<Program> CreateAnonymousFactory(string environment) =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            EnableAuthentication(builder);
            UseMidJulyClock(builder);
        });

    // Any environment with JWT authentication on and every request carrying an
    // organizer principal (stands in for a valid organizer token).
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

    [Theory]
    [InlineData("Development")]
    [InlineData(ButlerEnvironments.Demo)]
    public async Task Post_demo_seed_with_an_organizer_returns_200_in_Development_and_Demo(string environment)
    {
        using var factory = CreateBypassFactory(environment);
        using var client = factory.CreateClient();

        using var response = await client.PostAsync(SeedUri, content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var household = Assert.Single(await DemoTestHost.RowsAsync<HouseholdEntity>(factory));
        Assert.Equal(DemoHousehold.Id, household.RowKey);
    }

    [Theory]
    [InlineData("Development")]
    [InlineData(ButlerEnvironments.Demo)]
    public async Task Post_demo_seed_with_an_organizer_token_returns_200_in_Development_and_Demo(string environment)
    {
        using var factory = CreateOrganizerFactory(environment);
        using var client = factory.CreateClient();

        using var response = await client.PostAsync(SeedUri, content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Single(await DemoTestHost.RowsAsync<HouseholdEntity>(factory));
    }

    [Theory]
    [InlineData("Development")]
    [InlineData(ButlerEnvironments.Demo)]
    public async Task Post_demo_seed_without_a_token_is_challenged_in_Development_and_Demo(string environment)
    {
        using var factory = CreateAnonymousFactory(environment);
        using var client = factory.CreateClient();

        using var response = await client.PostAsync(SeedUri, content: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Empty(await DemoTestHost.RowsAsync<HouseholdEntity>(factory));
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public async Task Post_demo_seed_with_an_organizer_returns_404_outside_Development_or_Demo(string environment)
    {
        using var factory = CreateOrganizerFactory(environment);
        using var client = factory.CreateClient();

        using var response = await client.PostAsync(SeedUri, content: null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Empty(await DemoTestHost.RowsAsync<HouseholdEntity>(factory));
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public async Task Post_demo_seed_without_a_token_returns_404_outside_Development_or_Demo(string environment)
    {
        using var factory = CreateAnonymousFactory(environment);
        using var client = factory.CreateClient();

        using var response = await client.PostAsync(SeedUri, content: null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Empty(await DemoTestHost.RowsAsync<HouseholdEntity>(factory));
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public void Demo_controller_is_not_registered_outside_Development_or_Demo(string environment)
    {
        using var factory = CreateAnonymousFactory(environment);

        var actions = factory.Services
            .GetRequiredService<IActionDescriptorCollectionProvider>()
            .ActionDescriptors.Items
            .OfType<ControllerActionDescriptor>()
            .ToList();

        Assert.NotEmpty(actions);
        Assert.DoesNotContain(actions, action => action.ControllerTypeInfo.AsType() == typeof(DemoController));
    }

    [Theory]
    [InlineData("Development")]
    [InlineData(ButlerEnvironments.Demo)]
    public void Demo_controller_is_registered_in_Development_and_Demo(string environment)
    {
        using var factory = CreateBypassFactory(environment);

        var actions = factory.Services
            .GetRequiredService<IActionDescriptorCollectionProvider>()
            .ActionDescriptors.Items
            .OfType<ControllerActionDescriptor>();

        Assert.Contains(actions, action => action.ControllerTypeInfo.AsType() == typeof(DemoController));
    }
}
