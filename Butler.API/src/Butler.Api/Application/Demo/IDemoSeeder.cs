namespace Butler.Api.Application.Demo;

/// <summary>
/// Seeds the demo household (#97): the Parker family's rooms, people, chores,
/// three weeks of completion history, the current week's assignments, and a
/// small cart, all written through the existing application services and
/// repositories rather than raw table writes.
/// </summary>
/// <remarks>
/// <para>
/// <b>Replace, not merge.</b> The household always lives at the stable id
/// <see cref="DemoHousehold.Id"/>. A second run wipes that household's rows
/// (households, people, rooms, chores, assignments, completions, carts, cart
/// items) and seeds it again from scratch, so there are never duplicates. A
/// paired hub device is kept, so a tablet survives a re-seed.
/// </para>
/// <para>
/// <b>Dev and Demo only.</b> Outside the Development and Demo environments the
/// seeder throws <see cref="DemoSeedingNotAllowedException"/> before touching
/// storage.
/// </para>
/// <para>
/// Every date is derived from the injected <see cref="TimeProvider"/>: the
/// clock's ISO week is the current week, and the history fills the three weeks
/// before it.
/// </para>
/// </remarks>
public interface IDemoSeeder
{
    /// <summary>Seeds (or re-seeds) the demo household.</summary>
    /// <param name="organizerObjectId">
    /// Object id of the organizer who will own the household. Stored on the
    /// hidden organizer roster row so that organizer can confirm the demo cart.
    /// </param>
    /// <param name="organizerDisplayName">The organizer's display name, when known.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A summary of what was seeded, including the stable household id.</returns>
    /// <exception cref="DemoSeedingNotAllowedException">The host is not Development or Demo.</exception>
    Task<DemoSeedResponse> SeedAsync(
        string organizerObjectId,
        string? organizerDisplayName,
        CancellationToken cancellationToken = default);
}
