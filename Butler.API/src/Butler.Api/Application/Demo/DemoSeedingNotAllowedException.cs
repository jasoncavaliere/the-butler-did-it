namespace Butler.Api.Application.Demo;

/// <summary>
/// Thrown when demo seeding is asked to run outside the Development and Demo
/// environments. The API maps it to <c>404</c> so the endpoint looks absent
/// rather than forbidden. Use <see cref="ForEnvironment"/> to name the
/// environment that refused, or <see cref="ForSeedOnStartup"/> when the
/// <c>Demo:SeedOnStartup</c> start-up switch is what asked (#106).
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

    /// <summary>
    /// Creates the start-up refusal (#106): a message that names the
    /// <see cref="DemoCommandLine.SeedOnStartupKey"/> setting and the refusing
    /// environment, so the operator knows which switch to turn off.
    /// </summary>
    /// <param name="environmentName">The current host environment name.</param>
    public static DemoSeedingNotAllowedException ForSeedOnStartup(string environmentName) =>
        new($"{DemoCommandLine.SeedOnStartupKey} ({DemoCommandLine.SeedDemoSwitch}) is only permitted in the " +
            $"Development or Demo environment. Refusing to start in '{environmentName}' with demo seeding " +
            "enabled (fail closed).");
}
