using System.Net;
using System.Net.Http.Json;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Butler.Api.Tests.People;

/// <summary>
/// Criteria (H3 / Engineering Contract 7.4): with authentication enabled, people
/// reads are open to the hub/participant while mutations are organizer-gated. An
/// unauthenticated caller is challenged (<c>401</c>) on create/update/delete but
/// served on list/single-read; an authenticated caller that lacks the Organizer
/// policy is forbidden (<c>403</c>).
/// </summary>
public sealed class PeopleAuthorizationTests
{
    private static WebApplicationFactory<Program> CreateAuthEnabledFactory()
    {
        return new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(Environments.Production);
            builder.UseSetting("Authentication:DisableAuthentication", "false");
            builder.UseSetting(
                "Authentication:Authority",
                "https://login.example.com/00000000-0000-0000-0000-000000000000/v2.0");
            builder.UseSetting("Authentication:Audience", "api://butler-test");
        });
    }

    /// <summary>
    /// Boots the app with the real Organizer authorization policy in force, but
    /// with a default authentication scheme that authenticates every request as
    /// an authenticated non-organizer (a participant). The policy's
    /// <c>RequireRole(Organizer)</c> then fails for an authenticated principal,
    /// yielding <c>403 Forbidden</c> rather than a <c>401</c> challenge.
    /// </summary>
    private static WebApplicationFactory<Program> CreateNonOrganizerFactory()
    {
        return new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.ConfigureTestServices(services =>
            {
                services
                    .AddAuthentication(NonOrganizerAuthenticationHandler.SchemeName)
                    .AddScheme<AuthenticationSchemeOptions, NonOrganizerAuthenticationHandler>(
                        NonOrganizerAuthenticationHandler.SchemeName,
                        configureOptions: null);
            });
        });
    }

    [Fact]
    public async Task Reads_are_open_but_mutations_require_the_organizer()
    {
        using var factory = CreateAuthEnabledFactory();
        using var client = factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var peopleUri = new Uri($"/households/{householdId}/people", UriKind.Relative);
        var personUri = new Uri($"/households/{householdId}/people/some-person", UriKind.Relative);

        // Open reads: no token, but not challenged. List is 200; unknown single is 404.
        using var list = await client.GetAsync(peopleUri);
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);

        using var single = await client.GetAsync(personUri);
        Assert.Equal(HttpStatusCode.NotFound, single.StatusCode);

        // Organizer-gated mutations: no token -> 401.
        using var create = await client.PostAsJsonAsync(
            peopleUri,
            new { displayName = "Alex", role = "Participant", isChild = false, claimColor = (string?)null });
        Assert.Equal(HttpStatusCode.Unauthorized, create.StatusCode);

        using var updateRequest = new HttpRequestMessage(HttpMethod.Put, personUri)
        {
            Content = JsonContent.Create(
                new { displayName = "Alex", role = "Participant", isChild = false, claimColor = (string?)null }),
        };
        updateRequest.Headers.TryAddWithoutValidation("If-Match", "*");
        using var update = await client.SendAsync(updateRequest);
        Assert.Equal(HttpStatusCode.Unauthorized, update.StatusCode);

        using var delete = await client.DeleteAsync(personUri);
        Assert.Equal(HttpStatusCode.Unauthorized, delete.StatusCode);
    }

    [Fact]
    public async Task Authenticated_non_organizer_is_forbidden_from_creating_a_person()
    {
        // AC4: an authenticated caller that lacks the Organizer policy calling
        // POST /households/{householdId}/people is rejected with 403 (not 401).
        using var factory = CreateNonOrganizerFactory();
        using var client = factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var peopleUri = new Uri($"/households/{householdId}/people", UriKind.Relative);

        using var create = await client.PostAsJsonAsync(
            peopleUri,
            new { displayName = "Alex", role = "Participant", isChild = false, claimColor = (string?)null });

        Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);
    }

    [Fact]
    public async Task Authenticated_non_organizer_is_forbidden_from_deleting_a_person()
    {
        // AC8: an authenticated caller that lacks the Organizer policy calling
        // DELETE /households/{householdId}/people/{personId} is rejected with 403
        // (not 401). The organizer delete-removes-row path is covered by
        // PeopleCrudTests.AddParticipant.
        using var factory = CreateNonOrganizerFactory();
        using var client = factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var personUri = new Uri($"/households/{householdId}/people/some-person", UriKind.Relative);

        using var delete = await client.DeleteAsync(personUri);

        Assert.Equal(HttpStatusCode.Forbidden, delete.StatusCode);
    }
}
