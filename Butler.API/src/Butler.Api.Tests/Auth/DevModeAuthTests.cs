using System.Net;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Auth;

/// <summary>
/// Criterion (Engineering Contract 7.4): in dev mode
/// (<c>Authentication:DisableAuthentication</c>, the Development default) the
/// <c>Organizer</c> policy is permissive - the sample protected endpoint
/// <c>GET /me</c> succeeds and resolves the deterministic dev-organizer
/// principal without any token. The shared <see cref="ButlerApiFactory"/> boots
/// in Development, so this exercises the default local + CI path.
/// </summary>
public sealed class DevModeAuthTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public DevModeAuthTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Get_me_succeeds_in_dev_mode_and_resolves_the_dev_organizer()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(new Uri("/me", UriKind.Relative));

        // The protected endpoint returns success: the Organizer policy is
        // satisfied by the injected dev principal, no token required.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        // The resolved caller is the deterministic dev organizer.
        Assert.Equal(
            OrganizerAuthorization.DevOrganizerSubject,
            root.GetProperty("subject").GetString());
        Assert.Equal(
            OrganizerAuthorization.DevOrganizerName,
            root.GetProperty("name").GetString());
    }
}
