using Butler.Api.Application.Fairness;
using NSubstitute;

namespace Butler.Api.Tests.Fairness;

/// <summary>
/// Criterion: the <see cref="GetFairnessQuery"/> handler is a thin pass-through to
/// <see cref="IFairnessService"/> - it forwards the household id and window and
/// returns the service's result unchanged - and rejects a null service.
/// </summary>
public sealed class GetFairnessQueryHandlerTests
{
    [Fact]
    public async Task Handle_delegates_to_the_service_and_returns_its_result()
    {
        var service = Substitute.For<IFairnessService>();
        var expected = new FairnessResponse("2026-W26", "2026-W29", 4, 0, null, Array.Empty<PersonShare>());
        service.GetAsync("house-1", 4, Arg.Any<CancellationToken>()).Returns(expected);

        var handler = new GetFairnessQueryHandler(service);

        var result = await handler.Handle(new GetFairnessQuery("house-1", 4), CancellationToken.None);

        Assert.Same(expected, result);
        await service.Received(1).GetAsync("house-1", 4, Arg.Any<CancellationToken>());
    }

    [Fact]
    public void Constructor_rejects_a_null_service()
    {
        Assert.Throws<ArgumentNullException>(() => new GetFairnessQueryHandler(null!));
    }
}
