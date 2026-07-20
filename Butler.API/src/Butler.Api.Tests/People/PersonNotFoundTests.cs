using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.People;

/// <summary>
/// Criterion (H3): an unknown <c>personId</c> (or a person in an unknown
/// household) returns <c>404</c> as an RFC 7807 problem details document on the
/// single-read, update, and delete endpoints (Engineering Contract 7.5).
/// </summary>
public sealed class PersonNotFoundTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public PersonNotFoundTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Get_unknown_person_returns_404_problem_details()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(UnknownPersonUri());

        await AssertPersonNotFound(response);
    }

    [Fact]
    public async Task Update_unknown_person_returns_404_problem_details()
    {
        using var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Put, UnknownPersonUri())
        {
            Content = JsonContent.Create(
                new { displayName = "Ghost", role = "Participant", isChild = false, claimColor = (string?)null }),
        };
        request.Headers.TryAddWithoutValidation("If-Match", "*");
        using var response = await client.SendAsync(request);

        await AssertPersonNotFound(response);
    }

    [Fact]
    public async Task Delete_unknown_person_returns_404_problem_details()
    {
        using var client = _factory.CreateClient();

        using var response = await client.DeleteAsync(UnknownPersonUri());

        await AssertPersonNotFound(response);
    }

    private static Uri UnknownPersonUri()
    {
        var householdId = Guid.NewGuid().ToString("N");
        return new Uri($"/households/{householdId}/people/does-not-exist", UriKind.Relative);
    }

    private static async Task AssertPersonNotFound(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        Assert.Equal(404, root.GetProperty("status").GetInt32());
        Assert.Equal("Person not found.", root.GetProperty("title").GetString());
    }
}
