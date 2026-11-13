using System.Globalization;

namespace Butler.Api.ContainerTests;

/// <summary>
/// Criterion (#95 AC7): Butler.API/.dockerignore keeps host build output
/// (<c>bin/</c>, <c>obj/</c>), every test project, and Azurite data out of the
/// Docker build context. The test plants sentinel files where those paths live,
/// exports the context Docker actually sends (BuildKit, <c>COPY . /</c> from
/// <c>scratch</c> to a local directory), and inspects what arrived.
/// </summary>
public sealed class BuildContextTests
{
    private const string ProbeDockerfile = "FROM scratch\nCOPY . /\n";

    [Fact]
    public async Task Build_context_excludes_bin_obj_test_projects_and_azurite_data()
    {
        var context = ContainerPaths.BuildContext;
        var sentinel = $"container-test-sentinel-{Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture)}.txt";

        // Planted so each exclusion is proven, not passed because the path was absent.
        string[] planted =
        [
            Path.Combine("src", "Butler.Api", "bin", sentinel),
            Path.Combine("src", "Butler.Api", "obj", sentinel),
            Path.Combine(".azurite", sentinel),
            Path.Combine("src", "Butler.Api", ".azurite", sentinel),
            "__azurite_db_table__container_test__.json",
        ];

        var createdDirectories = new List<string>();
        var createdFiles = new List<string>();
        var export = Path.Combine(Path.GetTempPath(), $"butler-api-context-{Guid.NewGuid():N}");
        try
        {
            foreach (var relative in planted)
            {
                var full = Path.Combine(context, relative);
                var directory = Path.GetDirectoryName(full)!;
                if (!Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                    createdDirectories.Add(directory);
                }

                if (!File.Exists(full))
                {
                    await File.WriteAllTextAsync(full, "planted by Butler.Api.ContainerTests");
                    createdFiles.Add(full);
                }
            }

            await DockerCli.RunCheckedAsync(
                ["build", "--file", "-", "--output", $"type=local,dest={export}", context],
                ProbeDockerfile);

            // Positive control: the export really is the build context.
            Assert.True(File.Exists(Path.Combine(export, "global.json")), "global.json should be in the context.");
            Assert.True(
                File.Exists(Path.Combine(export, "src", "Butler.Api", "Program.cs")),
                "src/Butler.Api/Program.cs should be in the context.");

            var paths = Directory.EnumerateFileSystemEntries(export, "*", SearchOption.AllDirectories)
                .Select(p => Path.GetRelativePath(export, p).Replace('\\', '/'))
                .ToList();

            Assert.DoesNotContain(paths, p => HasSegment(p, "bin"));
            Assert.DoesNotContain(paths, p => HasSegment(p, "obj"));
            Assert.DoesNotContain(paths, p => HasSegment(p, ".azurite"));
            Assert.DoesNotContain(paths, p => p.Contains("__azurite_db", StringComparison.Ordinal));
            Assert.DoesNotContain(paths, p => p.Contains(sentinel, StringComparison.Ordinal));

            // The only project in the context is the API itself: no test project leaks in.
            var projects = Directory.EnumerateDirectories(Path.Combine(export, "src"))
                .Select(Path.GetFileName)
                .ToList();
            Assert.Equal(["Butler.Api"], projects);
            Assert.DoesNotContain(paths, p => p.Contains("Tests", StringComparison.Ordinal));
        }
        finally
        {
            foreach (var file in createdFiles)
            {
                File.Delete(file);
            }

            foreach (var directory in Enumerable.Reverse(createdDirectories))
            {
                if (Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any())
                {
                    Directory.Delete(directory);
                }
            }

            if (Directory.Exists(export))
            {
                Directory.Delete(export, recursive: true);
            }
        }
    }

    private static bool HasSegment(string relativePath, string segment) =>
        relativePath.Split('/').Contains(segment, StringComparer.Ordinal);
}
