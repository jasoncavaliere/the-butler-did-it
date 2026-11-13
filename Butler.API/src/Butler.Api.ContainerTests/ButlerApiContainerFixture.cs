using System.Globalization;
using System.Net;
using System.Text.Json;

namespace Butler.Api.ContainerTests;

/// <summary>
/// Builds Butler.API/Dockerfile once per test class (<c>docker build</c> on the
/// Butler.API/ context, exactly as the README documents), runs the image with
/// container port 8080 published to a free loopback port, and waits until
/// <c>/health</c> answers. The image and container are removed afterwards.
/// No storage settings are passed, so the container uses the in-memory store.
/// </summary>
public sealed class ButlerApiContainerFixture : IAsyncLifetime
{
    /// <summary>The port the image is built to listen on inside the container.</summary>
    public const string ContainerPort = "8080/tcp";

    private static readonly TimeSpan StartupTimeout = TimeSpan.FromSeconds(90);

    private readonly string _id = Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture)[..12];

    /// <summary>The unique tag this run builds (removed on dispose).</summary>
    public string ImageTag => $"butler-api-container-test:{_id}";

    /// <summary>The unique container name this run starts (removed on dispose).</summary>
    public string ContainerName => $"butler-api-container-test-{_id}";

    /// <summary>The image's <c>Config</c> block from <c>docker image inspect</c>, as JSON.</summary>
    public string ImageConfigJson { get; private set; } = string.Empty;

    /// <summary>The host address Docker mapped container port 8080 to.</summary>
    public Uri BaseAddress { get; private set; } = new("http://localhost/", UriKind.Absolute);

    /// <summary>A client whose base address is <see cref="BaseAddress"/>.</summary>
    public HttpClient Client { get; private set; } = new();

    /// <summary>Reads the running container's console log.</summary>
    public async Task<string> ReadLogsAsync()
    {
        var logs = await DockerCli.RunCheckedAsync(["logs", ContainerName]);
        return logs.Output;
    }

    /// <inheritdoc />
    public async Task InitializeAsync()
    {
        try
        {
            await DockerCli.RunCheckedAsync(["build", "--tag", ImageTag, ContainerPaths.BuildContext]);

            var inspect = await DockerCli.RunCheckedAsync(
                ["image", "inspect", "--format", "{{json .Config}}", ImageTag]);
            ImageConfigJson = inspect.StandardOutput.Trim();

            await DockerCli.RunCheckedAsync(
                ["run", "--detach", "--name", ContainerName, "--publish", $"127.0.0.1::{ContainerPort}", ImageTag]);

            var port = await DockerCli.RunCheckedAsync(["port", ContainerName, ContainerPort]);
            var hostEndpoint = port.StandardOutput
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)[0];
            BaseAddress = new Uri($"http://{hostEndpoint}/", UriKind.Absolute);

            Client.Dispose();
            Client = new HttpClient { BaseAddress = BaseAddress, Timeout = TimeSpan.FromSeconds(5) };

            await WaitForHealthAsync();
        }
        catch
        {
            await CleanUpAsync();
            throw;
        }
    }

    /// <inheritdoc />
    public Task DisposeAsync() => CleanUpAsync();

    private async Task WaitForHealthAsync()
    {
        var deadline = DateTimeOffset.UtcNow + StartupTimeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            var state = await DockerCli.RunCheckedAsync(
                ["container", "inspect", "--format", "{{.State.Running}}", ContainerName]);
            if (!state.StandardOutput.Trim().Equals("true", StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"The container exited before /health answered. Logs:{Environment.NewLine}{await ReadLogsAsync()}");
            }

            try
            {
                using var response = await Client.GetAsync(new Uri("health", UriKind.Relative));
                if (response.StatusCode == HttpStatusCode.OK)
                {
                    return;
                }
            }
            catch (HttpRequestException)
            {
                // Not listening yet - keep polling until the deadline.
            }
            catch (TaskCanceledException)
            {
                // Request timed out while the app was starting - keep polling.
            }

            await Task.Delay(TimeSpan.FromMilliseconds(500));
        }

        throw new InvalidOperationException(
            $"/health did not answer 200 within {StartupTimeout}. Logs:{Environment.NewLine}{await ReadLogsAsync()}");
    }

    private async Task CleanUpAsync()
    {
        Client.Dispose();
        await DockerCli.RunAsync(["rm", "--force", ContainerName]);
        await DockerCli.RunAsync(["image", "rm", "--force", ImageTag]);
    }

    /// <summary>The image's environment variables (<c>NAME=value</c>).</summary>
    public IReadOnlyList<string> ImageEnvironment()
    {
        using var config = JsonDocument.Parse(ImageConfigJson);
        return config.RootElement.GetProperty("Env").EnumerateArray()
            .Select(e => e.GetString() ?? string.Empty)
            .ToList();
    }
}
