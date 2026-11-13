using System.Net;
using System.Text.Json;
using Butler.Api.Application.Demo;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Demo;

/// <summary>
/// Criterion (#97 AC3): an organizer's <c>POST /demo/seed</c> seeds the demo
/// household and returns its stable id; a non-organizer is forbidden.
/// </summary>
public sealed class DemoEndpointTests
{
    [Fact]
    public async Task Post_demo_seed_returns_200_with_the_household_id()
    {
        using var factory = DemoTestHost.CreateFactory(new MutableClock(DemoTestHost.MidJuly));
        using var client = factory.CreateClient();

        using var response = await client.PostAsync(new Uri("/demo/seed", UriKind.Relative), content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(DemoHousehold.Id, doc.RootElement.GetProperty("householdId").GetString());
        Assert.Equal("2026-W29", doc.RootElement.GetProperty("currentWeekIso").GetString());
        Assert.Equal(15, doc.RootElement.GetProperty("assignmentCount").GetInt32());

        // The household is really there, readable through the normal endpoint.
        using var household = await client.GetAsync(new Uri($"/households/{DemoHousehold.Id}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, household.StatusCode);
    }

    [Fact]
    public async Task Post_demo_seed_is_forbidden_for_a_non_organizer()
    {
        using var factory = new ButlerApiFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
                services
                    .AddAuthentication(NonOrganizerAuthenticationHandler.SchemeName)
                    .AddScheme<AuthenticationSchemeOptions, NonOrganizerAuthenticationHandler>(
                        NonOrganizerAuthenticationHandler.SchemeName,
                        configureOptions: null)));
        using var client = factory.CreateClient();

        using var response = await client.PostAsync(new Uri("/demo/seed", UriKind.Relative), content: null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Empty(await DemoTestHost.RowsAsync<HouseholdEntity>(factory));
    }
}
