using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Application.Capture;

/// <summary>
/// Composition entry point for the Capture feature (Engineering Contract 7.2,
/// BRD decision D-5). Registers the shared resolve-and-add handler and both v1
/// sources behind the <see cref="ICaptureSource"/> seam; <c>Program.cs</c> wires
/// the feature with a single <see cref="AddCaptureFeature"/> call. It owns no
/// tables of its own - it writes through the Carts feature's repositories and
/// resolves products through the store-connector seam, so both of those must be
/// registered too.
/// </summary>
public static class CaptureServiceCollectionExtensions
{
    /// <summary>Registers the capture seam, its two v1 sources, and the shared handler.</summary>
    public static IServiceCollection AddCaptureFeature(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Scoped like the other application services: it orchestrates per-request
        // repository work.
        services.TryAddScoped<ICaptureHandler, CaptureHandler>();

        // The sources are a set, resolved by name. TryAddEnumerable keeps a repeat
        // call idempotent while still allowing a third source to be appended
        // (the Section 9 live-assistant fast-follow).
        services.TryAddEnumerable(ServiceDescriptor.Scoped<ICaptureSource, HubTextCaptureSource>());
        services.TryAddEnumerable(ServiceDescriptor.Scoped<ICaptureSource, SimulatedVoiceCaptureSource>());

        return services;
    }
}
