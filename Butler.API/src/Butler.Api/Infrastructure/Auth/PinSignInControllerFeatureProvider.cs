using System.Reflection;
using Butler.Api.Controllers;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;

namespace Butler.Api.Infrastructure.Auth;

/// <summary>
/// Removes <see cref="OrganizerPinController"/> from the discovered controllers
/// unless the demo PIN organizer is the active mode (#105), so
/// <c>/auth/pin/*</c> is <c>404</c> under the dev bypass and under Entra. It runs
/// after the framework's default <see cref="ControllerFeatureProvider"/>.
/// </summary>
public sealed class PinSignInControllerFeatureProvider : IApplicationFeatureProvider<ControllerFeature>
{
    private readonly OrganizerAuthMode _mode;

    /// <summary>Creates the provider for the resolved organizer mode.</summary>
    /// <param name="mode">The resolved organizer authentication mode.</param>
    public PinSignInControllerFeatureProvider(OrganizerAuthMode mode) => _mode = mode;

    /// <inheritdoc />
    public void PopulateFeature(IEnumerable<ApplicationPart> parts, ControllerFeature feature)
    {
        ArgumentNullException.ThrowIfNull(feature);

        if (_mode == OrganizerAuthMode.Pin)
        {
            return;
        }

        feature.Controllers.Remove(typeof(OrganizerPinController).GetTypeInfo());
    }
}
