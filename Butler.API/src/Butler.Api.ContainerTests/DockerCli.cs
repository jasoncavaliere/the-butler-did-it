using System.Diagnostics;
using System.Text;

namespace Butler.Api.ContainerTests;

/// <summary>The outcome of one <c>docker</c> CLI invocation.</summary>
/// <param name="ExitCode">The process exit code (0 = success).</param>
/// <param name="StandardOutput">Everything the command wrote to stdout.</param>
/// <param name="StandardError">Everything the command wrote to stderr.</param>
public sealed record DockerResult(int ExitCode, string StandardOutput, string StandardError)
{
    /// <summary>True when the command exited with 0.</summary>
    public bool Succeeded => ExitCode == 0;

    /// <summary>Stdout and stderr together, for assertion messages.</summary>
    public string Output => $"{StandardOutput}{Environment.NewLine}{StandardError}";
}

/// <summary>
/// Runs the real <c>docker</c> CLI. The suite deliberately shells out rather than
/// using a Docker SDK so it exercises exactly the commands the README documents.
/// </summary>
public static class DockerCli
{
    /// <summary>Upper bound for any single docker command (a cold image build restores NuGet packages).</summary>
    public static readonly TimeSpan DefaultTimeout = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Runs <c>docker</c> with <paramref name="arguments"/>, optionally piping
    /// <paramref name="standardInput"/> to it, and returns its exit code and output.
    /// </summary>
    /// <param name="arguments">The CLI arguments, one per element (no shell quoting).</param>
    /// <param name="standardInput">Text written to the command's stdin, or null for none.</param>
    /// <exception cref="InvalidOperationException">docker is not installed or the command timed out.</exception>
    public static async Task<DockerResult> RunAsync(IEnumerable<string> arguments, string? standardInput = null)
    {
        ArgumentNullException.ThrowIfNull(arguments);

        var startInfo = new ProcessStartInfo("docker")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = standardInput is not null,
            UseShellExecute = false,
        };
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var process = new Process { StartInfo = startInfo };
        try
        {
            process.Start();
        }
        catch (System.ComponentModel.Win32Exception ex)
        {
            throw new InvalidOperationException(
                "The container suite needs the docker CLI on PATH and a running Docker daemon.", ex);
        }

        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();

        if (standardInput is not null)
        {
            await process.StandardInput.WriteAsync(standardInput);
            process.StandardInput.Close();
        }

        using var timeout = new CancellationTokenSource(DefaultTimeout);
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException ex)
        {
            process.Kill(entireProcessTree: true);
            throw new InvalidOperationException(
                $"docker {string.Join(' ', startInfo.ArgumentList)} did not finish within {DefaultTimeout}.", ex);
        }

        return new DockerResult(process.ExitCode, await stdout, await stderr);
    }

    /// <summary>Runs <c>docker</c> and fails the calling test if the command does not exit with 0.</summary>
    /// <param name="arguments">The CLI arguments, one per element.</param>
    /// <param name="standardInput">Text written to the command's stdin, or null for none.</param>
    public static async Task<DockerResult> RunCheckedAsync(IEnumerable<string> arguments, string? standardInput = null)
    {
        var list = arguments.ToList();
        var result = await RunAsync(list, standardInput);
        if (!result.Succeeded)
        {
            throw new InvalidOperationException(new StringBuilder()
                .Append("docker ").Append(string.Join(' ', list))
                .Append(" exited with ").Append(result.ExitCode).AppendLine(":")
                .Append(result.Output)
                .ToString());
        }

        return result;
    }
}
