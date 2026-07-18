namespace Butler.Api.Domain.System;

/// <summary>
/// Domain shape for the System feature: the health of the running service.
/// Domain types are storage/transport-agnostic; they carry meaning, not wiring.
/// </summary>
/// <param name="Status">Coarse health string, <c>"ok"</c> when serving.</param>
/// <param name="Service">Logical service name.</param>
public sealed record SystemStatus(string Status, string Service)
{
    /// <summary>The healthy status for the Butler API.</summary>
    public static SystemStatus Healthy { get; } = new("ok", "Butler.API");
}
