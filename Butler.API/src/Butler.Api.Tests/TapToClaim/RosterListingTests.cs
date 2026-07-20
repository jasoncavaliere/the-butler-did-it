using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Hosting;

namespace Butler.Api.Tests.TapToClaim;

/// <summary>
/// Criteria (T1): the claimable roster read returns only the fields a name tile
/// needs - <c>personId, displayName, claimColor, isChild</c> - and never leaks an
/// organizer-only field (<c>organizerObjectId</c>), the role, or the concurrency
/// <c>ETag</c>. It is an open read that works with no bearer token even when
/// authentication is enabled (the hub has no login).
/// </summary>
public sealed class RosterListingTests : IClassFixture<ButlerApiFactory>
{
    private static readonly string[] AllowedFields = ["personId", "displayName", "claimColor", "isChild"];

    private readonly ButlerApiFactory _factory;

    public RosterListingTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Roster_returns_only_the_claimable_fields()
    {
        using var client = _factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");
        var peopleUri = new Uri($"/households/{householdId}/people", UriKind.Relative);

        // Seed a person (organizer-gated create is satisfied by the dev organizer).
        using var createResponse = await client.PostAsJsonAsync(
            peopleUri,
            new { displayName = "Jamie", role = "Organizer", isChild = false, claimColor = "#0088ff" });
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);

        using var listResponse = await client.GetAsync(peopleUri);
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);

        using var listDoc = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
        var entry = Assert.Single(listDoc.RootElement.EnumerateArray().ToList());

        // The claimable fields are present and correct.
        Assert.Equal("Jamie", entry.GetProperty("displayName").GetString());
        Assert.Equal("#0088ff", entry.GetProperty("claimColor").GetString());
        Assert.False(entry.GetProperty("isChild").GetBoolean());
        Assert.False(string.IsNullOrWhiteSpace(entry.GetProperty("personId").GetString()));

        // Nothing else is projected - no role, no ETag, and no organizer binding.
        var actualFields = entry.EnumerateObject().Select(p => p.Name).ToArray();
        Assert.Equal(AllowedFields.OrderBy(f => f), actualFields.OrderBy(f => f));
        Assert.False(entry.TryGetProperty("role", out _));
        Assert.False(entry.TryGetProperty("eTag", out _));
        Assert.False(entry.TryGetProperty("organizerObjectId", out _));
    }

    [Fact]
    public async Task Roster_read_is_open_with_no_token_even_when_authentication_is_enabled()
    {
        using var factory = new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(Environments.Production);
            builder.UseSetting("Authentication:DisableAuthentication", "false");
            builder.UseSetting(
                "Authentication:Authority",
                "https://login.example.com/00000000-0000-0000-0000-000000000000/v2.0");
            builder.UseSetting("Authentication:Audience", "api://butler-test");
        });
        using var client = factory.CreateClient();
        var householdId = Guid.NewGuid().ToString("N");

        // No bearer token presented, yet the roster read is served (not challenged).
        using var list = await client.GetAsync(
            new Uri($"/households/{householdId}/people", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
    }
}
