namespace Butler.Api.Application.Demo;

/// <summary>
/// Thrown when the demo seeder is asked to run outside the Development and Demo
/// environments. The API maps it to <c>404</c> so the endpoint looks absent
/// rather than forbidden. Use <see cref="ForEnvironment"/> to name the
/// environment that refused.
/// </summary>
public sealed class DemoSeedingNotAllowedException : InvalidOperationException
{
    private const string DefaultMessage =
        "Demo seeding is only allowed in the Development and Demo environments.";

    public DemoSeedingNotAllowedException()
        : base(DefaultMessage)
    {
    }

    public DemoSeedingNotAllowedException(string message)
        : base(message)
    {
    }

    public DemoSeedingNotAllowedException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    /// <summary>Creates the exception with a message that names the refusing environment.</summary>
    /// <param name="environmentName">The current host environment name.</param>
    public static DemoSeedingNotAllowedException ForEnvironment(string environmentName) =>
        new($"Demo seeding is only allowed in the Development and Demo environments, not '{environmentName}'.");
}
