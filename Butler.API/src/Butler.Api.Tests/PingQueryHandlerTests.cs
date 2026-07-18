using Butler.Api.Application.System;
using Butler.Api.Domain.System;
using Butler.Api.Infrastructure.System;
using NSubstitute;

namespace Butler.Api.Tests;

/// <summary>
/// Unit tests for the F1 reference handler, exercised directly (no HTTP, no
/// MediatR pipeline). Collaborators are replaced with NSubstitute fakes - the
/// fake convention every later ticket follows: the handler's dependencies on the
/// Infrastructure boundary (<see cref="ISystemStatusProvider"/>) and the injected
/// clock (<see cref="TimeProvider"/>) are substituted so the test asserts the
/// handler's own behaviour in isolation.
/// </summary>
public sealed class PingQueryHandlerTests
{
    [Fact]
    public async Task Handle_projects_provider_status_and_stamps_the_injected_clock()
    {
        // Arrange: sentinel values distinct from SystemStatus.Healthy prove the
        // handler reads from the provider rather than hard-coding the response,
        // and a fixed clock proves it stamps the injected TimeProvider's time.
        var status = new SystemStatus("degraded", "Test.Service");
        var statusProvider = Substitute.For<ISystemStatusProvider>();
        statusProvider.GetStatus().Returns(status);

        var fixedNow = new DateTimeOffset(2026, 7, 18, 13, 45, 0, TimeSpan.Zero);
        var timeProvider = Substitute.For<TimeProvider>();
        timeProvider.GetUtcNow().Returns(fixedNow);

        var handler = new PingQueryHandler(statusProvider, timeProvider);

        // Act
        var result = await handler.Handle(new PingQuery(), CancellationToken.None);

        // Assert
        Assert.Equal("degraded", result.Status);
        Assert.Equal("Test.Service", result.Service);
        Assert.Equal(fixedNow, result.TimestampUtc);
        statusProvider.Received(1).GetStatus();
    }
}
