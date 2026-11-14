using Butler.Api.Application.Insights;
using NSubstitute;

namespace Butler.Api.Tests.Insights;

/// <summary>
/// Criterion: the <see cref="GetInsightsQuery"/> handler is a thin pass-through to
/// <see cref="IInsightsService"/> - it forwards the household id and window and
/// returns the service's result unchanged - and rejects a null service.
/// </summary>
public sealed class GetInsightsQueryHandlerTests
{
    [Fact]
    public async Task Handle_delegates_to_the_service_and_returns_its_result()
    {
        var service = Substitute.For<IInsightsService>();
        var expected = new InsightsResponse(
            "2026-W26",
            "2026-W29",
            4,
            Array.Empty<InsightsMember>(),
            Array.Empty<WeeklyInsight>(),
            Array.Empty<DailyCount>(),
            Array.Empty<MonthlyCount>());
        service.GetAsync("house-1", 4, Arg.Any<CancellationToken>()).Returns(expected);

        var handler = new GetInsightsQueryHandler(service);

        var result = await handler.Handle(new GetInsightsQuery("house-1", 4), CancellationToken.None);

        Assert.Same(expected, result);
        await service.Received(1).GetAsync("house-1", 4, Arg.Any<CancellationToken>());
    }

    [Fact]
    public void Constructor_rejects_a_null_service()
    {
        Assert.Throws<ArgumentNullException>(() => new GetInsightsQueryHandler(null!));
    }
}
