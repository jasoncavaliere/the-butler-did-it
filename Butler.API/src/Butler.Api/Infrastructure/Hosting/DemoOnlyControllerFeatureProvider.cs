using System.Reflection;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.Extensions.Hosting;

namespace Butler.Api.Infrastructure.Hosting;

/// <summary>
/// Removes every controller marked <see cref="DemoOnlyAttribute"/> from the
/// discovered controller set when the host is neither Development nor Demo
/// (#106). It runs after the framework's default <see cref="ControllerFeatureProvider"/>,
/// so the demo routes are never mapped outside those environments: requests to
/// them are <c>404</c> before authentication or authorization is consulted, and
/// they drop out of the API explorer too.
/// </summary>
public sealed class DemoOnlyControllerFeatureProvider : IApplicationFeatureProvider<ControllerFeature>
{
    private readonly IHostEnvironment _environment;

    /// <summary>Creates the provider for the given host environment.</summary>
    /// <param name="environment">The host environment that decides whether demo controllers stay.</param>
    public DemoOnlyControllerFeatureProvider(IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(environment);

        _environment = environment;
    }

    /// <inheritdoc />
    public void PopulateFeature(IEnumerable<ApplicationPart> parts, ControllerFeature feature)
    {
        ArgumentNullException.ThrowIfNull(feature);

        if (_environment.IsDevelopmentOrDemo())
        {
            return;
        }

        foreach (var controller in feature.Controllers.ToList())
        {
            if (controller.IsDefined(typeof(DemoOnlyAttribute), inherit: false))
            {
                feature.Controllers.Remove(controller);
            }
        }
    }
}
