using Butler.Api.Infrastructure.ChoreCompletions;

namespace Butler.Api.Tests.ChoreCompletions;

/// <summary>
/// Criteria (#220 AC1-AC3): <see cref="ChoreCompletionLedger.NetOfUndo"/> pairs each
/// <c>_void</c> reversal with the latest un-reversed completion of the same chore in
/// the same week - whoever pressed undo - and returns only the surviving
/// completions. An orphan reversal (nothing open to cancel) is dropped, so no
/// reader can ever see negative effort or a negative count.
/// </summary>
public sealed class ChoreCompletionLedgerTests
{
    private const string Week29 = "2026-W29";
    private const string Week28 = "2026-W28";

    private static readonly DateTimeOffset Now = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);

    private static ChoreCompletionEntity Completion(
        string personId, string choreId, int minute, int effort = 3, string weekIso = Week29) => new()
    {
        RowKey = $"{Now.AddMinutes(minute).UtcTicks}_{choreId}",
        ChoreId = choreId,
        PersonId = personId,
        Effort = effort,
        WeekIso = weekIso,
        CompletedUtc = Now.AddMinutes(minute),
    };

    private static ChoreCompletionEntity Reversal(
        string personId, string choreId, int minute, int effort = 3, string weekIso = Week29) => new()
    {
        RowKey = $"{Now.AddMinutes(minute).UtcTicks}_{choreId}{ChoreCompletionLedger.ReversalSuffix}",
        ChoreId = choreId,
        PersonId = personId,
        Effort = -effort,
        WeekIso = weekIso,
        CompletedUtc = Now.AddMinutes(minute),
    };

    [Fact]
    public void A_same_person_undo_cancels_the_completion()
    {
        var survivors = ChoreCompletionLedger.NetOfUndo(
        [
            Completion("alex", "dishes", 1),
            Reversal("alex", "dishes", 2),
        ]);

        Assert.Empty(survivors);
    }

    [Fact]
    public void A_cross_person_undo_cancels_the_completers_row_not_the_undoers()
    {
        var samTrash = Completion("sam", "trash", 1, effort: 2);
        var alexPlants = Completion("alex", "plants", 2, effort: 1);

        var survivors = ChoreCompletionLedger.NetOfUndo(
        [
            Reversal("sam", "dishes", 4),
            Completion("alex", "dishes", 3),
            alexPlants,
            samTrash,
        ]);

        // Returned in replay order; the reversal row itself is never returned.
        Assert.Equal([samTrash, alexPlants], survivors);
        Assert.All(survivors, row => Assert.False(ChoreCompletionLedger.IsReversal(row)));
    }

    [Fact]
    public void A_recomplete_after_a_cross_person_undo_survives()
    {
        var recomplete = Completion("sam", "dishes", 3);

        var survivors = ChoreCompletionLedger.NetOfUndo(
        [
            Completion("alex", "dishes", 1),
            Reversal("sam", "dishes", 2),
            recomplete,
        ]);

        Assert.Equal([recomplete], survivors);
    }

    [Fact]
    public void A_reversal_cancels_only_the_same_chore_in_the_same_week()
    {
        var otherChore = Completion("alex", "trash", 1);
        var otherWeek = Completion("alex", "dishes", 1, weekIso: Week28);

        var survivors = ChoreCompletionLedger.NetOfUndo(
        [
            otherChore,
            otherWeek,
            Completion("alex", "dishes", 2),
            Reversal("sam", "dishes", 3),
        ]);

        Assert.Equal(2, survivors.Count);
        Assert.Contains(otherChore, survivors);
        Assert.Contains(otherWeek, survivors);
    }

    [Fact]
    public void An_orphan_reversal_is_dropped()
    {
        var survivors = ChoreCompletionLedger.NetOfUndo([Reversal("alex", "dishes", 1)]);

        Assert.Empty(survivors);
    }

    [Fact]
    public void A_second_reversal_with_no_open_completion_is_dropped()
    {
        var later = Completion("alex", "dishes", 4);

        var survivors = ChoreCompletionLedger.NetOfUndo(
        [
            Completion("alex", "dishes", 1),
            Reversal("sam", "dishes", 2),
            Reversal("sam", "dishes", 3),
            later,
        ]);

        // The second reversal cancels nothing, so it can never eat a later completion.
        Assert.Equal([later], survivors);
    }

    [Fact]
    public void A_completion_and_its_undo_at_the_same_instant_still_net()
    {
        // Same CompletedUtc; the reversal's row key sorts before the completion's
        // ("a_..." < "z_..."), so only the completion-first tie-break pairs them.
        var completion = new ChoreCompletionEntity
        {
            RowKey = "z_dishes",
            ChoreId = "dishes",
            PersonId = "alex",
            Effort = 3,
            WeekIso = Week29,
            CompletedUtc = Now,
        };
        var reversal = new ChoreCompletionEntity
        {
            RowKey = "a_dishes" + ChoreCompletionLedger.ReversalSuffix,
            ChoreId = "dishes",
            PersonId = "sam",
            Effort = -3,
            WeekIso = Week29,
            CompletedUtc = Now,
        };

        Assert.Empty(ChoreCompletionLedger.NetOfUndo([reversal, completion]));
    }

    [Fact]
    public void Same_instant_completions_replay_in_row_key_order()
    {
        var first = Completion("alex", "dishes", 1);
        var second = Completion("sam", "trash", 1);

        Assert.Equal([first, second], ChoreCompletionLedger.NetOfUndo([second, first]));
    }

    [Fact]
    public void IsReversal_reads_the_row_key_suffix()
    {
        Assert.True(ChoreCompletionLedger.IsReversal(Reversal("alex", "dishes", 1)));
        Assert.False(ChoreCompletionLedger.IsReversal(Completion("alex", "dishes", 1)));
        Assert.False(ChoreCompletionLedger.IsReversal(new ChoreCompletionEntity { RowKey = "1_void_dishes" }));
    }

    [Fact]
    public void Rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => ChoreCompletionLedger.IsReversal(null!));
        Assert.Throws<ArgumentNullException>(() => ChoreCompletionLedger.NetOfUndo(null!));
    }
}
