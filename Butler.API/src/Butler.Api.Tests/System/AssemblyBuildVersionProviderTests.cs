using System.Reflection;
using Butler.Api.Domain.System;
using Butler.Api.Infrastructure.System;

namespace Butler.Api.Tests.System;

/// <summary>
/// Unit tests for <see cref="AssemblyBuildVersionProvider"/> (#126 AC1, AC2):
/// it turns the stamped assembly metadata into a <see cref="BuildVersion"/>,
/// falling back to <c>"dev"</c> and a <c>null</c> time when nothing is stamped.
/// </summary>
public sealed class AssemblyBuildVersionProviderTests
{
    [Fact]
    public void Stamped_sha_and_utc_time_are_reported()
    {
        var version = Provider(
            (AssemblyBuildVersionProvider.ShaKey, "abc1234"),
            (AssemblyBuildVersionProvider.BuildTimeKey, "2026-11-14T10:00:00Z")).GetVersion();

        Assert.Equal(new BuildVersion("abc1234", "2026-11-14T10:00:00Z"), version);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Missing_or_blank_sha_is_dev(string? sha)
    {
        var metadata = sha is null
            ? Provider()
            : Provider((AssemblyBuildVersionProvider.ShaKey, sha));

        Assert.Equal(BuildVersion.DevSha, metadata.GetVersion().Sha);
    }

    [Fact]
    public void Stamped_sha_is_trimmed()
    {
        var version = Provider((AssemblyBuildVersionProvider.ShaKey, "  abc1234\n")).GetVersion();

        Assert.Equal("abc1234", version.Sha);
    }

    [Theory]
    [InlineData("2026-11-14T12:30:00+02:00", "2026-11-14T10:30:00Z")]
    [InlineData("2026-11-14T10:30:00", "2026-11-14T10:30:00Z")]
    [InlineData("2026-11-14T10:30:00.987Z", "2026-11-14T10:30:00Z")]
    public void Build_time_with_an_offset_is_normalized_to_utc_z(string raw, string expected)
    {
        var version = Provider((AssemblyBuildVersionProvider.BuildTimeKey, raw)).GetVersion();

        Assert.Equal(expected, version.BuildTimeUtc);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-time")]
    public void Missing_or_unparseable_build_time_is_null(string? raw)
    {
        var provider = raw is null
            ? Provider((AssemblyBuildVersionProvider.ShaKey, "abc1234"))
            : Provider((AssemblyBuildVersionProvider.BuildTimeKey, raw));

        Assert.Null(provider.GetVersion().BuildTimeUtc);
    }

    [Fact]
    public void Unrelated_metadata_is_ignored()
    {
        var version = Provider(
            ("RepositoryUrl", "https://example.invalid"),
            ("buttlerbuildsha", "wrong-case"),
            ("BUTLERBUILDSHA", "wrong-case")).GetVersion();

        Assert.Equal(new BuildVersion(BuildVersion.DevSha, null), version);
    }

    [Fact]
    public void Last_repeated_key_wins()
    {
        var version = Provider(
            (AssemblyBuildVersionProvider.ShaKey, "first"),
            (AssemblyBuildVersionProvider.ShaKey, "second")).GetVersion();

        Assert.Equal("second", version.Sha);
    }

    [Fact]
    public void FromAssembly_reads_the_api_assembly()
    {
        // The real build may or may not be stamped (CI or a developer can pass
        // the properties), so only the shape is asserted, never an exact SHA.
        // BuildStampTests (#226) covers the exact stamped path with a real build.
        var version = AssemblyBuildVersionProvider
            .FromAssembly(typeof(AssemblyBuildVersionProvider).Assembly)
            .GetVersion();

        Assert.False(string.IsNullOrWhiteSpace(version.Sha));
    }

    [Fact]
    public void FromAssembly_requires_an_assembly()
    {
        Assert.Throws<ArgumentNullException>(() => AssemblyBuildVersionProvider.FromAssembly(null!));
    }

    [Fact]
    public void Ctor_requires_metadata()
    {
        Assert.Throws<ArgumentNullException>(() => new AssemblyBuildVersionProvider(null!));
    }

    private static AssemblyBuildVersionProvider Provider(params (string Key, string? Value)[] entries) =>
        new(entries.Select(entry => new AssemblyMetadataAttribute(entry.Key, entry.Value)).ToArray());
}
