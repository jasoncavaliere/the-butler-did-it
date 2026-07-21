using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Auth;
using Butler.Api.Domain.Scheduling;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.People;

namespace Butler.Api.Application.Fairness;

/// <summary>
/// Default <see cref="IFairnessService"/> - the C6 read model behind the fairness
/// view. It scans only the household's append-only <c>ChoreCompletions</c>
/// partition (<c>PartitionKey = householdId</c>, Engineering Contract 7.3; no
/// cross-household query), buckets completions into a trailing ISO-week window
/// anchored to the injected clock's current week, sums <c>Effort</c> per person,
/// joins display names from the People roster (H3), and computes each person's
/// share of the household total. It writes nothing. Time comes from the injected
/// <see cref="TimeProvider"/> seam so the window stays deterministic (7.5).
/// </summary>
public sealed class FairnessService : IFairnessService
{
    /// <summary>The default trailing-window length when the caller supplies none.</summary>
    public const int DefaultWindowWeeks = 4;

    private readonly IHouseholdRepository _households;
    private readonly IChoreCompletionRepository _completions;
    private readonly IPersonRepository _people;
    private readonly TimeProvider _clock;

    public FairnessService(
        IHouseholdRepository households,
        IChoreCompletionRepository completions,
        IPersonRepository people,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(households);
        ArgumentNullException.ThrowIfNull(completions);
        ArgumentNullException.ThrowIfNull(people);
        ArgumentNullException.ThrowIfNull(clock);
        _households = households;
        _completions = completions;
        _people = people;
        _clock = clock;
    }

    /// <inheritdoc />
    public async Task<FairnessResponse?> GetAsync(
        string householdId,
        int windowWeeks,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        // A window must span at least one week; a non-positive length is a client
        // error (400), not an empty aggregate.
        if (windowWeeks < 1)
        {
            throw new ValidationException(
                $"The fairness window must be at least 1 week; '{windowWeeks}' is not valid.");
        }

        // Unknown household is a 404, surfaced to the caller as a null result.
        var household = await _households.GetAsync(householdId, cancellationToken).ConfigureAwait(false);
        if (household is null)
        {
            return null;
        }

        var window = TrailingWindow(windowWeeks);

        // Read the roster first so organizers can be excluded from every aggregate.
        // Organizers administer the household; they are not chore-doing members and
        // are never counted in the fairness balance (this also excludes the seeded
        // dev organizer, whose row carries the organizer role - it must never appear
        // as a household member on the board). This mirrors the T1 roster read.
        var people = await _people.ListAsync(householdId, cancellationToken).ConfigureAwait(false);
        var organizerIds = new HashSet<string>(
            people
                .Where(person => string.Equals(
                    person.Role,
                    OrganizerAuthorization.OrganizerRole,
                    StringComparison.Ordinal))
                .Select(person => person.RowKey),
            StringComparer.Ordinal);

        // The aggregate reads only this household's completions partition - the
        // Section 10 fairness guardrail computed without any cross-household query.
        var completions = await _completions.ListAsync(householdId, cancellationToken).ConfigureAwait(false);

        var effortByPerson = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var completion in completions)
        {
            if (!window.Weeks.Contains(completion.WeekIso))
            {
                continue;
            }

            // An organizer's completion (if the ledger ever carries one) is not part
            // of the household's shared load, so it never contributes to the total.
            if (organizerIds.Contains(completion.PersonId))
            {
                continue;
            }

            effortByPerson[completion.PersonId] =
                effortByPerson.GetValueOrDefault(completion.PersonId) + completion.Effort;
        }

        var totalEffort = effortByPerson.Values.Sum();

        // Display names come from the roster; a completion attributed to a person
        // who has since left the roster still counts (the ledger is the source of
        // truth) and falls back to showing its id.
        var displayNames = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var person in people)
        {
            displayNames[person.RowKey] = person.DisplayName;
        }

        // Report every current chore-doing roster member (so a zero-contributor
        // still shows on the balance view) plus any ledger person no longer on the
        // roster - but never an organizer.
        var personIds = new HashSet<string>(effortByPerson.Keys, StringComparer.Ordinal);
        foreach (var person in people)
        {
            if (organizerIds.Contains(person.RowKey))
            {
                continue;
            }

            personIds.Add(person.RowKey);
        }

        var shares = personIds
            .Select(id =>
            {
                var effort = effortByPerson.GetValueOrDefault(id);
                // Total-safe: with a zero household total every share is zero rather
                // than a divide-by-zero.
                var share = totalEffort == 0 ? 0d : (double)effort / totalEffort;
                return new PersonShare(
                    id,
                    displayNames.GetValueOrDefault(id, id),
                    effort,
                    share,
                    Math.Round(share * 100d, 1, MidpointRounding.AwayFromZero));
            })
            .OrderByDescending(share => share.TotalEffort)
            .ThenBy(share => share.PersonId, StringComparer.Ordinal)
            .ToList();

        // The top contributor is the greatest-effort person (shares are ordered by
        // effort), but only when there is at least one completion in the window.
        var topContributor = totalEffort == 0 ? null : shares[0].PersonId;

        return new FairnessResponse(
            window.StartWeekIso,
            window.EndWeekIso,
            windowWeeks,
            totalEffort,
            topContributor,
            shares);
    }

    // The trailing window: the current ISO week (from the injected clock) and the
    // preceding weeks, computed with the same deterministic WeekIso helper the
    // assignment engine buckets on.
    private TrailingWeekWindow TrailingWindow(int windowWeeks)
    {
        var currentWeek = WeekIso.For(_clock.GetUtcNow());
        var monday = WeekIso.StartOfWeekUtc(currentWeek);

        var weeks = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < windowWeeks; i++)
        {
            weeks.Add(WeekIso.For(monday.AddDays(-7 * i)));
        }

        var startWeek = WeekIso.For(monday.AddDays(-7 * (windowWeeks - 1)));
        return new TrailingWeekWindow(weeks, startWeek, currentWeek);
    }

    private sealed record TrailingWeekWindow(
        HashSet<string> Weeks,
        string StartWeekIso,
        string EndWeekIso);
}
