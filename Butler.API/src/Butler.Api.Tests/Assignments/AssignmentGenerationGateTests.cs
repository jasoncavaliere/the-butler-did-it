using Butler.Api.Application.Assignments;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Criteria (issue #110): the per-household generation lock serializes callers
/// for the same household, never blocks a different household, rejects a blank
/// household id, honours cancellation while waiting, and disposes cleanly.
/// </summary>
public sealed class AssignmentGenerationGateTests
{
    [Fact]
    public async Task The_same_household_waits_for_the_holder_to_release()
    {
        using var gate = new AssignmentGenerationGate();
        var held = await gate.EnterAsync("house-1", CancellationToken.None);

        var second = gate.EnterAsync("house-1", CancellationToken.None);
        await Task.Delay(50);
        Assert.False(second.IsCompleted);

        held.Release();
        var acquired = await second.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Same(held, acquired);
        acquired.Release();
    }

    [Fact]
    public async Task Different_households_do_not_block_each_other()
    {
        using var gate = new AssignmentGenerationGate();
        var first = await gate.EnterAsync("house-1", CancellationToken.None);

        var other = await gate.EnterAsync("house-2", CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5));

        Assert.NotSame(first, other);
        first.Release();
        other.Release();
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    public async Task A_blank_household_is_rejected(string householdId)
    {
        using var gate = new AssignmentGenerationGate();

        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => gate.EnterAsync(householdId, CancellationToken.None));
    }

    [Fact]
    public async Task A_cancelled_wait_throws()
    {
        using var gate = new AssignmentGenerationGate();
        var held = await gate.EnterAsync("house-1", CancellationToken.None);
        using var cancellation = new CancellationTokenSource();
        await cancellation.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => gate.EnterAsync("house-1", cancellation.Token));
        held.Release();
    }

    [Fact]
    public async Task Dispose_is_safe_with_and_without_locks_and_twice()
    {
        var gate = new AssignmentGenerationGate();
        var held = await gate.EnterAsync("house-1", CancellationToken.None);
        held.Release();

        gate.Dispose();
        gate.Dispose();
        new AssignmentGenerationGate().Dispose();
    }
}
