using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Chores;

/// <summary>
/// Criterion (H4): an unknown <c>choreId</c> (or a chore in an unknown household)
/// returns <c>404</c> as an RFC 7807 problem details document on the single-read,
/// update, and deactivate endpoints (Engineering Contract 7.5).
/// The household is seeded: an update in an unknown household is now the
/// household <c>404</c> (#295, <c>OrganizerWriteAfterTeardownTests</c>).
/// </summary>
public sealed class ChoreNotFoundTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public ChoreNotFoundTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Get_unknown_chore_returns_404_problem_details()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(await UnknownChoreUriAsync());

        await AssertChoreNotFound(response);
    }

    [Fact]
    public async Task Update_unknown_chore_returns_404_problem_details()
    {
        using var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Put, await UnknownChoreUriAsync())
        {
            Content = JsonContent.Create(
                new { title = "Ghost", roomId = "room", cadence = "Daily", effort = 1, minAge = (int?)null, active = true }),
        };
        request.Headers.TryAddWithoutValidation("If-Match", "*");
        using var response = await client.SendAsync(request);

        await AssertChoreNotFound(response);
    }

    [Fact]
    public async Task Deactivate_unknown_chore_returns_404_problem_details()
    {
        using var client = _factory.CreateClient();
        var uri = new Uri($"{(await UnknownChoreUriAsync()).OriginalString}/deactivate", UriKind.Relative);

        using var response = await client.PostAsync(uri, content: null);

        await AssertChoreNotFound(response);
    }

    private async Task<Uri> UnknownChoreUriAsync()
    {
        // Seeded so the 404 is the unknown child, not the unknown household (#295).
        var householdId = await TestHouseholds.SeedAsync(_factory.Services);
        return new Uri($"/households/{householdId}/chores/does-not-exist", UriKind.Relative);
    }

    private static async Task AssertChoreNotFound(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        Assert.Equal(404, root.GetProperty("status").GetInt32());
        Assert.Equal("Chore not found.", root.GetProperty("title").GetString());
    }
}
