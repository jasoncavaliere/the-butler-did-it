namespace Butler.Api.Application.System;

/// <summary>Body of <c>GET /api/system/version</c> (#126).</summary>
/// <param name="Sha">The git short SHA the API was built from, or <c>"dev"</c> when unstamped.</param>
/// <param name="BuildTime">The ISO 8601 UTC build time, or <c>null</c> when unstamped.</param>
public sealed record VersionResponse(string Sha, string? BuildTime);
