namespace Butler.Api.Domain.System;

/// <summary>
/// Domain shape for the build the API is running (#126): the git short SHA and
/// UTC build time stamped into the assembly at build time.
/// </summary>
/// <param name="Sha">The git short SHA, or <see cref="DevSha"/> when the build carries no stamp.</param>
/// <param name="BuildTimeUtc">
/// The build time as ISO 8601 UTC (<c>yyyy-MM-ddTHH:mm:ssZ</c>), or <c>null</c>
/// when the build carries no (parseable) time.
/// </param>
public sealed record BuildVersion(string Sha, string? BuildTimeUtc)
{
    /// <summary>The SHA reported by a build that was not stamped.</summary>
    public const string DevSha = "dev";
}
