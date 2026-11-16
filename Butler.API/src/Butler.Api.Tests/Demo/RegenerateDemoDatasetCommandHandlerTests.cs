using Butler.Api.Application.Demo;
using Butler.Api.Application.System;
using NSubstitute;

namespace Butler.Api.Tests.Demo;

/// <summary>
/// Unit tests for <see cref="RegenerateDemoDatasetCommandHandler"/> (#99 AC3): it
/// returns whatever new id the dataset service hands it.
/// </summary>
public sealed class RegenerateDemoDatasetCommandHandlerTests
{
    [Fact]
    public async Task Handler_returns_the_service_id()
    {
        var service = Substitute.For<IDatasetService>();
        service.RegenerateAsync(Arg.Any<CancellationToken>()).Returns("sentinel-id");

        var result = await new RegenerateDemoDatasetCommandHandler(service)
            .Handle(new RegenerateDemoDatasetCommand(), CancellationToken.None);

        Assert.Equal(new DatasetResponse("sentinel-id"), result);
        await service.Received(1).RegenerateAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public void Handler_requires_a_service()
    {
        Assert.Throws<ArgumentNullException>(() => new RegenerateDemoDatasetCommandHandler(null!));
    }
}
