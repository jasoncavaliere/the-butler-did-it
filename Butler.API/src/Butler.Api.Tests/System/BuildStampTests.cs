using System.Diagnostics;
using System.Runtime.Loader;
using System.Security.Cryptography;
using System.Text;
using Butler.Api.Domain.System;
using Butler.Api.Infrastructure.System;

namespace Butler.Api.Tests.System;

/// <summary>
/// End-to-end check of the build version stamp (#226 AC1, AC2): it runs a real
/// <c>dotnet build</c> of <c>Butler.Api.csproj</c> with <c>/p:ButlerBuildSha</c>
/// and <c>/p:ButlerBuildTime</c> into a temp folder, loads the built assembly,
/// and reads the stamp back through <see cref="AssemblyBuildVersionProvider.FromAssembly"/>.
/// Dropping the csproj <c>AssemblyMetadata</c> items makes the build report
/// <c>"dev"</c>, so this test fails.
/// </summary>
/// <remarks>
/// Only <c>IntermediateOutputPath</c> and <c>OutDir</c> are redirected, never
/// <c>BaseIntermediateOutputPath</c>: the SDK default item excludes cover the base
/// paths, so moving them would compile the real obj/ generated sources twice.
/// The build uses <c>--no-restore</c> because the test project's own build has
/// already restored <c>Butler.Api</c>. Build servers and node reuse are off so no
/// MSBuild or compiler process outlives the test.
/// </remarks>
public sealed class BuildStampTests
{
    private const string BuildTime = "2026-11-14T10:00:00Z";

    private static readonly TimeSpan BuildTimeout = TimeSpan.FromMinutes(10);

    [Fact]
    public async Task Building_the_api_with_stamp_properties_reports_them_through_FromAssembly()
    {
        // A fresh SHA per run, so a stale build or a leaked property cannot pass.
        var sha = RandomNumberGenerator.GetHexString(7, lowercase: true);
        var apiRoot = FindApiRoot();
        var tempRoot = Path.Combine(Path.GetTempPath(), $"butler-stamp-{Guid.NewGuid():N}");
        var outDir = Path.Combine(tempRoot, "bin") + Path.DirectorySeparatorChar;
        var intermediateDir = Path.Combine(tempRoot, "obj") + Path.DirectorySeparatorChar;

        var context = new AssemblyLoadContext($"butler-stamp-{sha}", isCollectible: true);
        try
        {
            var (exitCode, output) = await RunDotnetAsync(apiRoot,
            [
                "build",
                Path.Combine("src", "Butler.Api", "Butler.Api.csproj"),
                "--configuration", "Release",
                "--no-restore",
                "--disable-build-servers",
                "-nodeReuse:false",
                "-p:UseSharedCompilation=false",
                $"-p:IntermediateOutputPath={intermediateDir}",
                $"-p:OutDir={outDir}",
                $"-p:{AssemblyBuildVersionProvider.ShaKey}={sha}",
                $"-p:{AssemblyBuildVersionProvider.BuildTimeKey}={BuildTime}",
            ]);

            Assert.True(exitCode == 0, $"dotnet build exited with {exitCode}:{Environment.NewLine}{output}");

            var assemblyPath = Path.Combine(outDir, "Butler.Api.dll");
            Assert.True(File.Exists(assemblyPath), $"{assemblyPath} was not built:{Environment.NewLine}{output}");

            // LoadFromStream keeps no lock on the file, so the temp folder can be deleted.
            using var stream = File.OpenRead(assemblyPath);
            var loaded = context.LoadFromStream(stream);

            var version = AssemblyBuildVersionProvider.FromAssembly(loaded).GetVersion();

            Assert.Equal(new BuildVersion(sha, BuildTime), version);
        }
        finally
        {
            context.Unload();
            try
            {
                Directory.Delete(tempRoot, recursive: true);
            }
            catch (DirectoryNotFoundException)
            {
                // The build never created it.
            }
            catch (IOException)
            {
                // Best effort: a leftover temp folder is harmless.
            }
            catch (UnauthorizedAccessException)
            {
                // Best effort, as above.
            }
        }
    }

    /// <summary>
    /// The Butler.API/ directory: the nearest ancestor of the test output folder
    /// holding <c>Butler.API.sln</c> and <c>src/Butler.Api/Butler.Api.csproj</c>.
    /// Building from there lets <c>global.json</c> pin the SDK.
    /// </summary>
    private static string FindApiRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "Butler.API.sln"))
                && File.Exists(Path.Combine(directory.FullName, "src", "Butler.Api", "Butler.Api.csproj")))
            {
                return directory.FullName;
            }
        }

        throw new InvalidOperationException(
            $"Could not find Butler.API/ (Butler.API.sln + src/Butler.Api/Butler.Api.csproj) above {AppContext.BaseDirectory}.");
    }

    /// <summary>
    /// Runs the dotnet CLI in <paramref name="workingDirectory"/> and returns its exit
    /// code with stdout and stderr together. MSBuild* environment variables that
    /// <c>dotnet test</c> leaks into this process are removed so they cannot steer
    /// the child build.
    /// </summary>
    private static async Task<(int ExitCode, string Output)> RunDotnetAsync(
        string workingDirectory, IEnumerable<string> arguments)
    {
        var hostPath = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH");
        var executable = !string.IsNullOrEmpty(hostPath) && File.Exists(hostPath) ? hostPath : "dotnet";

        var startInfo = new ProcessStartInfo(executable)
        {
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        var leakedKeys = startInfo.Environment.Keys
            .Where(key => key.StartsWith("MSBuild", StringComparison.OrdinalIgnoreCase))
            .ToList();
        foreach (var key in leakedKeys)
        {
            startInfo.Environment.Remove(key);
        }

        using var process = new Process { StartInfo = startInfo };
        process.Start();

        // Read both pipes before waiting: build output can fill the pipe buffer.
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();

        using var timeout = new CancellationTokenSource(BuildTimeout);
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException ex)
        {
            process.Kill(entireProcessTree: true);
            throw new InvalidOperationException(
                $"{executable} {string.Join(' ', startInfo.ArgumentList)} did not finish within {BuildTimeout}.", ex);
        }

        var output = new StringBuilder()
            .Append(executable).Append(' ').AppendJoin(' ', startInfo.ArgumentList).AppendLine()
            .AppendLine(await stdout)
            .Append(await stderr)
            .ToString();
        return (process.ExitCode, output);
    }
}
