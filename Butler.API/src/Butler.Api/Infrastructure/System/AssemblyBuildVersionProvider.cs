using System.Globalization;
using System.Reflection;
using Butler.Api.Domain.System;

namespace Butler.Api.Infrastructure.System;

/// <summary>
/// Default <see cref="IBuildVersionProvider"/> (#126): parses the
/// <c>ButlerBuildSha</c> and <c>ButlerBuildTime</c> assembly metadata that
/// <c>Butler.Api.csproj</c> stamps when the build passes those MSBuild
/// properties. The metadata is parsed once, in the constructor.
/// </summary>
/// <remarks>
/// The SHA is trimmed; a missing or blank SHA becomes <see cref="BuildVersion.DevSha"/>.
/// The build time is parsed as invariant-culture date/time (a value with no
/// offset is taken as UTC) and normalized to <c>yyyy-MM-ddTHH:mm:ssZ</c>; a
/// missing or unparseable time becomes <c>null</c>. Keys match ordinally and,
/// when a key repeats, the last value wins.
/// </remarks>
public sealed class AssemblyBuildVersionProvider : IBuildVersionProvider
{
    /// <summary>The metadata key that carries the git short SHA.</summary>
    public const string ShaKey = "ButlerBuildSha";

    /// <summary>The metadata key that carries the UTC build time.</summary>
    public const string BuildTimeKey = "ButlerBuildTime";

    private const string UtcFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'";

    private readonly BuildVersion _version;

    public AssemblyBuildVersionProvider(IEnumerable<AssemblyMetadataAttribute> metadata)
    {
        ArgumentNullException.ThrowIfNull(metadata);

        string? sha = null;
        string? buildTime = null;
        foreach (var attribute in metadata)
        {
            if (string.Equals(attribute.Key, ShaKey, StringComparison.Ordinal))
            {
                sha = attribute.Value;
            }
            else if (string.Equals(attribute.Key, BuildTimeKey, StringComparison.Ordinal))
            {
                buildTime = attribute.Value;
            }
        }

        _version = new BuildVersion(NormalizeSha(sha), NormalizeBuildTime(buildTime));
    }

    /// <summary>Builds a provider from the metadata stamped into <paramref name="assembly"/>.</summary>
    public static AssemblyBuildVersionProvider FromAssembly(Assembly assembly)
    {
        ArgumentNullException.ThrowIfNull(assembly);
        return new AssemblyBuildVersionProvider(assembly.GetCustomAttributes<AssemblyMetadataAttribute>());
    }

    /// <inheritdoc />
    public BuildVersion GetVersion() => _version;

    private static string NormalizeSha(string? sha) =>
        string.IsNullOrWhiteSpace(sha) ? BuildVersion.DevSha : sha.Trim();

    private static string? NormalizeBuildTime(string? buildTime)
    {
        if (!DateTimeOffset.TryParse(
                buildTime,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var parsed))
        {
            return null;
        }

        return parsed.UtcDateTime.ToString(UtcFormat, CultureInfo.InvariantCulture);
    }
}
