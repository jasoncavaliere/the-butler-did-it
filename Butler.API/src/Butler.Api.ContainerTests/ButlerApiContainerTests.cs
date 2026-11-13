using System.Net;
using System.Text.Json;

namespace Butler.Api.ContainerTests;

/// <summary>
/// Criteria (#95 AC1, AC2, AC6, AC8): <c>docker build</c> on Butler.API/ produces
/// an image from the multi-stage Dockerfile whose final stage is the ASP.NET 10
/// runtime (no SDK), the running container listens on port 8080, and real HTTP
/// to that port gets <c>GET /health</c> 200 and the Demo-environment Swagger
/// document. A broken Dockerfile, publish output, entrypoint, or port fails here.
/// </summary>
public sealed class ButlerApiContainerTests : IClassFixture<ButlerApiContainerFixture>
{
    private readonly ButlerApiContainerFixture _container;

    public ButlerApiContainerTests(ButlerApiContainerFixture container)
    {
        _container = container;
    }

    [Fact]
    public void Image_builds_from_the_multi_stage_Dockerfile_onto_the_ASP_NET_10_runtime()
    {
        var environment = _container.ImageEnvironment();

        // The final stage is the ASP.NET runtime image at .NET 10 ...
        Assert.Contains(environment, e => e.StartsWith("ASPNET_VERSION=10.", StringComparison.Ordinal));
        Assert.Contains(environment, e => e.StartsWith("DOTNET_VERSION=10.", StringComparison.Ordinal));
        // ... and not the SDK image: the SDK stage only builds and publishes.
        Assert.DoesNotContain(environment, e => e.StartsWith("DOTNET_SDK_VERSION=", StringComparison.Ordinal));

        using var config = JsonDocument.Parse(_container.ImageConfigJson);
        var entrypoint = config.RootElement.GetProperty("Entrypoint").EnumerateArray()
            .Select(e => e.GetString())
            .ToList();
        Assert.Equal(["dotnet", "Butler.Api.dll"], entrypoint);
    }

    [Fact]
    public async Task Running_container_listens_on_port_8080()
    {
        Assert.Contains("ASPNETCORE_HTTP_PORTS=8080", _container.ImageEnvironment());

        using var config = JsonDocument.Parse(_container.ImageConfigJson);
        Assert.True(
            config.RootElement.GetProperty("ExposedPorts").TryGetProperty(ButlerApiContainerFixture.ContainerPort, out _),
            $"The image should EXPOSE {ButlerApiContainerFixture.ContainerPort}; config was {_container.ImageConfigJson}");

        var logs = await _container.ReadLogsAsync();
        Assert.Contains("Now listening on: http://[::]:8080", logs, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Running_container_serves_health_200()
    {
        using var response = await _container.Client.GetAsync(new Uri("health", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("ok", doc.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Running_container_defaults_to_Demo_and_serves_swagger()
    {
        Assert.Contains("ASPNETCORE_ENVIRONMENT=Demo", _container.ImageEnvironment());

        using var response = await _container.Client.GetAsync(new Uri("swagger/v1/swagger.json", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
