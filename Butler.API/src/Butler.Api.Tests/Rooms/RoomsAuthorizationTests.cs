using System.Net;
using System.Net.Http.Json;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Hosting;

namespace Butler.Api.Tests.Rooms;

/// <summary>
/// Criterion (H2 / Engineering Contract 7.4): with authentication enabled, room
/// reads are open to the hub/participant while mutations are organizer-gated. An
/// unauthenticated caller is challenged (<c>401</c>) on create/update/delete but
/// served on list/single-read.
/// </summary>
public sealed class RoomsAuthorizationTests
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

    [Fact]
    public async Task Reads_are_open_but_mutations_require_the_organizer()
    {
        using var factory = CreateAuthEnabledFactory();
        using var client = factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var roomsUri = new Uri($"/households/{householdId}/rooms", UriKind.Relative);
        var roomUri = new Uri($"/households/{householdId}/rooms/some-room", UriKind.Relative);

        // Open reads: no token, but not challenged. List is 200; unknown single is 404.
        using var list = await client.GetAsync(roomsUri);
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);

        using var single = await client.GetAsync(roomUri);
        Assert.Equal(HttpStatusCode.NotFound, single.StatusCode);

        // Organizer-gated mutations: no token -> 401.
        using var create = await client.PostAsJsonAsync(roomsUri, new { name = "Kitchen", sortOrder = 1 });
        Assert.Equal(HttpStatusCode.Unauthorized, create.StatusCode);

        using var updateRequest = new HttpRequestMessage(HttpMethod.Put, roomUri)
        {
            Content = JsonContent.Create(new { name = "Kitchen", sortOrder = 1 }),
        };
        updateRequest.Headers.TryAddWithoutValidation("If-Match", "*");
        using var update = await client.SendAsync(updateRequest);
        Assert.Equal(HttpStatusCode.Unauthorized, update.StatusCode);

        using var delete = await client.DeleteAsync(roomUri);
        Assert.Equal(HttpStatusCode.Unauthorized, delete.StatusCode);
    }
}
