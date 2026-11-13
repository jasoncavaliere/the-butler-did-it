namespace Butler.Api.Infrastructure.Demo;

/// <summary>
/// Removes every row a demo household owns so the demo seeder can replace it
/// cleanly (#97). This is a demo-only tool: it deletes the
/// <c>ChoreCompletions</c> ledger too, which is otherwise append-only (BRD R-2).
/// The application services cannot do this wipe - the last organizer cannot be
/// removed, chores only deactivate, and the ledger has no delete - so it goes
/// straight to the shared <see cref="Storage.IEntityRepository{TEntity}"/> seam.
/// </summary>
public interface IDemoHouseholdPurger
{
    /// <summary>
    /// Deletes the household's rows from the <c>Households</c>, <c>People</c>,
    /// <c>Rooms</c>, <c>Chores</c>, <c>Assignments</c>, <c>ChoreCompletions</c>,
    /// <c>Carts</c>, and <c>CartItems</c> tables. <c>HubDevices</c> rows are kept
    /// on purpose, so a paired tablet keeps working after a re-seed. Purging a
    /// household that does not exist is a no-op.
    /// </summary>
    /// <param name="householdId">The household partition to clear.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>How many rows were deleted.</returns>
    Task<int> PurgeAsync(string householdId, CancellationToken cancellationToken = default);
}
