namespace Butler.Api.ContainerTests;

/// <summary>Locates the Butler.API/ directory - the Docker build context - from the test binaries.</summary>
public static class ContainerPaths
{
    /// <summary>
    /// The Butler.API/ directory: the nearest ancestor of the test output folder
    /// that holds both <c>Butler.API.sln</c> and <c>Dockerfile</c>.
    /// </summary>
    public static string BuildContext { get; } = FindBuildContext();

    private static string FindBuildContext()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "Butler.API.sln"))
                && File.Exists(Path.Combine(directory.FullName, "Dockerfile")))
            {
                return directory.FullName;
            }
        }

        throw new InvalidOperationException(
            $"Could not find Butler.API/ (Butler.API.sln + Dockerfile) above {AppContext.BaseDirectory}.");
    }
}
