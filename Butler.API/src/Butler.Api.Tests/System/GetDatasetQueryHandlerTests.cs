using Butler.Api.Application.System;
using NSubstitute;

namespace Butler.Api.Tests.System;

/// <summary>
/// Unit tests for <see cref="GetDatasetQueryHandler"/> (#100 AC1): it returns
/// whatever id the dataset service hands it.
/// </summary>
public sealed class GetDatasetQueryHandlerTests
{
    [Fact]
    public async Task Handler_returns_the_service_id()
    {
        var service = Substitute.For<IDatasetService>();
        service.GetOrCreateAsync(Arg.Any<CancellationToken>()).Returns("sentinel-id");

        var result = await new GetDatasetQueryHandler(service).Handle(new GetDatasetQuery(), CancellationToken.None);

        Assert.Equal(new DatasetResponse("sentinel-id"), result);
    }

    [Fact]
    public void Handler_requires_a_service()
    {
        Assert.Throws<ArgumentNullException>(() => new GetDatasetQueryHandler(null!));
    }
}
