namespace Butler.Api.Infrastructure.ChoreCompletions;

/// <summary>
/// Reads the append-only <c>ChoreCompletions</c> ledger net of undo (issue #220).
/// A completion appends <c>{ticks}_{choreId}</c>; an undo never deletes it (BRD R-2)
/// and instead appends a reversal row, <c>{ticks}_{choreId}_void</c>, stamped with
/// the person who pressed undo. That person need not be the one who completed the
/// chore, so a read model that summed effort by each row's <c>PersonId</c> would
/// charge the undoer and leave the completer credited. <see cref="NetOfUndo"/>
/// instead pairs each reversal with the completion it reverses and drops both, so
/// every read model attributes effort only to the people whose completions still
/// stand. The helper is pure: it reads the rows it is given and writes nothing.
/// </summary>
public static class ChoreCompletionLedger
{
    /// <summary>The row-key suffix that marks a reversal (undo) row.</summary>
    public const string ReversalSuffix = "_void";

    /// <summary>Returns <c>true</c> when <paramref name="row"/> is a reversal (undo) row.</summary>
    /// <param name="row">A ledger row.</param>
    /// <returns><c>true</c> when the row key ends with <see cref="ReversalSuffix"/>.</returns>
    public static bool IsReversal(ChoreCompletionEntity row)
    {
        ArgumentNullException.ThrowIfNull(row);
        return row.RowKey.EndsWith(ReversalSuffix, StringComparison.Ordinal);
    }

    /// <summary>
    /// Returns the completions that still stand once every undo is applied. Rows are
    /// replayed in <see cref="ChoreCompletionEntity.CompletedUtc"/> order (a
    /// completion before a reversal at the same instant, then row key, ordinal).
    /// Within each (<see cref="ChoreCompletionEntity.WeekIso"/>,
    /// <see cref="ChoreCompletionEntity.ChoreId"/>) a reversal cancels the latest
    /// completion it has not already cancelled - the one the undo actually reversed,
    /// whoever pressed undo - and a reversal with nothing open to cancel is dropped
    /// as an orphan. Only surviving completion rows are returned, never a reversal,
    /// so the completer's net returns exactly to its earlier value (even if the
    /// chore's effort was edited between complete and undo) and no person's count
    /// or effort can go negative.
    /// </summary>
    /// <param name="rows">The ledger rows to net, in any order.</param>
    /// <returns>The surviving completion rows, in replay order.</returns>
    public static IReadOnlyList<ChoreCompletionEntity> NetOfUndo(IEnumerable<ChoreCompletionEntity> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);

        var ordered = rows
            .OrderBy(row => row.CompletedUtc)
            .ThenBy(row => IsReversal(row) ? 1 : 0)
            .ThenBy(row => row.RowKey, StringComparer.Ordinal);

        var open = new Dictionary<(string WeekIso, string ChoreId), Stack<ChoreCompletionEntity>>();
        var cancelled = new HashSet<ChoreCompletionEntity>(ReferenceEqualityComparer.Instance);
        var completions = new List<ChoreCompletionEntity>();
        foreach (var row in ordered)
        {
            var key = (row.WeekIso, row.ChoreId);
            if (!open.TryGetValue(key, out var stack))
            {
                stack = new Stack<ChoreCompletionEntity>();
                open[key] = stack;
            }

            if (!IsReversal(row))
            {
                stack.Push(row);
                completions.Add(row);
            }
            else if (stack.TryPop(out var reversed))
            {
                cancelled.Add(reversed);
            }
        }

        return completions.Where(row => !cancelled.Contains(row)).ToList();
    }
}
