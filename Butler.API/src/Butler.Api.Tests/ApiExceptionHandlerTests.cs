using System.Net;
using System.Text.Json;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests;

/// <summary>
/// Criterion: <c>Mediation/ApiExceptionHandler</c> maps unhandled exceptions and
/// validation failures to RFC 7807 problem details, wired into the pipeline in
/// <c>Program.cs</c>. Each case drives a real request that throws through the
/// wired <c>UseExceptionHandler</c> and asserts the resulting problem document.
/// </summary>
public sealed class ApiExceptionHandlerTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public ApiExceptionHandlerTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task Unhandled_exception_maps_to_500_problem_details()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(new Uri("/test/unhandled", UriKind.Relative));

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        await AssertProblemDetailsAsync(response, expectedStatus: 500, expectedTitle: "An unexpected error occurred.");
    }

    [Fact]
    public async Task DataAnnotations_validation_exception_maps_to_400_problem_details()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(new Uri("/test/data-annotations-validation", UriKind.Relative));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertProblemDetailsAsync(response, expectedStatus: 400, expectedTitle: "Validation failed.");
    }

    [Fact]
    public async Task Named_validation_exception_maps_to_400_via_type_name_match()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(new Uri("/test/named-validation", UriKind.Relative));

        // This is the fragile branch: a non-DataAnnotations type whose name is
        // "ValidationException" must still be classified as a 400.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertProblemDetailsAsync(response, expectedStatus: 400, expectedTitle: "Validation failed.");
    }

    private static async Task AssertProblemDetailsAsync(
        HttpResponseMessage response,
        int expectedStatus,
        string expectedTitle)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        Assert.Equal(expectedStatus, root.GetProperty("status").GetInt32());
        Assert.Equal(expectedTitle, root.GetProperty("title").GetString());
    }
}
