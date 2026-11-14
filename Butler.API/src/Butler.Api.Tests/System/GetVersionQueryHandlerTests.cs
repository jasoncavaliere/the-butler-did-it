using Butler.Api.Application.System;
using Butler.Api.Domain.System;
using Butler.Api.Infrastructure.System;
using NSubstitute;

namespace Butler.Api.Tests.System;

/// <summary>
/// Unit tests for <see cref="GetVersionQueryHandler"/> (#126 AC1, AC2): it maps
/// whatever build version the provider reports onto the response.
/// </summary>
public sealed class GetVersionQueryHandlerTests
{
    [Fact]
    public async Task Handler_maps_the_provider_version()
    {
        var provider = Substitute.For<IBuildVersionProvider>();
        provider.GetVersion().Returns(new BuildVersion("abc1234", "2026-11-14T10:00:00Z"));

        var result = await new GetVersionQueryHandler(provider).Handle(new GetVersionQuery(), CancellationToken.None);

        Assert.Equal(new VersionResponse("abc1234", "2026-11-14T10:00:00Z"), result);
    }

    [Fact]
    public void Handler_requires_a_provider()
    {
        Assert.Throws<ArgumentNullException>(() => new GetVersionQueryHandler(null!));
    }
}
