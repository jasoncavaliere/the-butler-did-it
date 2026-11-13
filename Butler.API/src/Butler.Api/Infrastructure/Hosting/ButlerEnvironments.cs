using Microsoft.Extensions.Hosting;

namespace Butler.Api.Infrastructure.Hosting;

/// <summary>
/// Butler's named hosting environments beyond the framework's built-in ones.
/// <c>Demo</c> is the local demo stack (the container image defaults to it): it
/// serves Swagger like Development and permits the organizer-auth bypass when it
/// is set explicitly (see <c>appsettings.Demo.json</c>).
/// </summary>
public static class ButlerEnvironments
{
    /// <summary>The name of the local demo-stack environment.</summary>
    public const string Demo = "Demo";

    /// <summary>Whether the host is running in the <see cref="Demo"/> environment.</summary>
    /// <param name="environment">The host environment.</param>
    /// <returns><c>true</c> when the environment name is <see cref="Demo"/> (case-insensitive).</returns>
    public static bool IsDemo(this IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(environment);

        return environment.IsEnvironment(Demo);
    }

    /// <summary>Whether the host is running in Development or <see cref="Demo"/>.</summary>
    /// <param name="environment">The host environment.</param>
    /// <returns><c>true</c> for Development or <see cref="Demo"/>; otherwise <c>false</c>.</returns>
    public static bool IsDevelopmentOrDemo(this IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(environment);

        return environment.IsDevelopment() || environment.IsDemo();
    }
}
