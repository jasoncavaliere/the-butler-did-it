using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Events;
using Butler.Api.Domain.Scheduling;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Events;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.People;

namespace Butler.Api.Application.Insights;

/// <summary>
/// Default <see cref="IInsightsService"/> - the organizer's insights read model
/// (#123). It reads only the household's own partitions of the
/// <c>ChoreCompletions</c>, <c>People</c>, <c>Events</c> and <c>Carts</c> tables
/// (<c>PartitionKey = householdId</c>, Engineering Contract 7.3) and writes
/// nothing. The window is the current ISO week from the injected
/// <see cref="TimeProvider"/> and the weeks before it (7.5); every bucket is UTC.
/// </summary>
public sealed class InsightsService : IInsightsService
{
    /// <summary>The longest window a caller may ask for (a year of weeks); anything above is a <c>400</c>.</summary>
    public const int MaxWeeks = 52;

    // An undo appends a reversal row whose RowKey ends with this suffix and whose
    // effort is negated (ChoreCompletionService.UndoAsync).
    private const string ReversalSuffix = "_void";

    private readonly IHouseholdRepository _households;
    private readonly IChoreCompletionRepository _completions;
    private readonly IPersonRepository _people;
    private readonly IEventRepository _events;
    private readonly ICartRepository _carts;
    private readonly TimeProvider _clock;

    public InsightsService(
        IHouseholdRepository households,
        IChoreCompletionRepository completions,
        IPersonRepository people,
        IEventRepository events,
        ICartRepository carts,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(households);
        ArgumentNullException.ThrowIfNull(completions);
        ArgumentNullException.ThrowIfNull(people);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(carts);
        ArgumentNullException.ThrowIfNull(clock);
        _households = households;
        _completions = completions;
        _people = people;
        _events = events;
        _carts = carts;
        _clock = clock;
    }

    /// <inheritdoc />
    public async Task<InsightsResponse?> GetAsync(
        string householdId,
        int? weeks,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        // A missing or out-of-range window is a client error (400). The cap keeps
        // the date math in range and the payload bounded.
        if (weeks is not { } windowWeeks || windowWeeks < 1 || windowWeeks > MaxWeeks)
        {
            throw new ValidationException(
                $"The insights window must be between 1 and {MaxWeeks} weeks; " +
                $"'{weeks?.ToString(CultureInfo.InvariantCulture) ?? "(missing)"}' is not valid.");
        }

        // Unknown household is a 404, surfaced to the caller as a null result.
        var household = await _households.GetAsync(householdId, cancellationToken).ConfigureAwait(false);
        if (household is null)
        {
            return null;
        }

        var now = _clock.GetUtcNow();
        var currentWeekStart = WeekIso.StartOfWeekUtc(WeekIso.For(now));
        var windowStartUtc = currentWeekStart.AddDays(-7 * (windowWeeks - 1));
        var weekKeys = Enumerable.Range(0, windowWeeks)
            .Select(i => WeekIso.For(windowStartUtc.AddDays(7 * i)))
            .ToList();

        var people = await _people.ListAsync(householdId, cancellationToken).ConfigureAwait(false);
        var completions = await _completions.ListAsync(householdId, cancellationToken).ConfigureAwait(false);
        var events = await _events.ListAsync(householdId, cancellationToken).ConfigureAwait(false);
        var carts = await _carts.ListAsync(householdId, cancellationToken).ConfigureAwait(false);

        // Organizers administer the household; they are never part of the member
        // series (the same exclusion the fairness view applies).
        var organizerIds = new HashSet<string>(
            people
                .Where(person => string.Equals(
                    person.Role,
                    OrganizerAuthorization.OrganizerRole,
                    StringComparison.Ordinal))
                .Select(person => person.RowKey),
            StringComparer.Ordinal);

        var inWindow = new HashSet<string>(weekKeys, StringComparer.Ordinal);
        var memberRows = completions
            .Where(row => inWindow.Contains(row.WeekIso) && !organizerIds.Contains(row.PersonId))
            .ToList();

        var members = BuildMembers(people, organizerIds, memberRows);
        var weekly = weekKeys
            .Select(weekIso => BuildWeek(
                weekIso,
                members,
                memberRows.Where(row => string.Equals(row.WeekIso, weekIso, StringComparison.Ordinal))))
            .ToList();

        return new InsightsResponse(
            weekKeys[0],
            weekKeys[^1],
            windowWeeks,
            members,
            weekly,
            GlancesPerDay(events, windowStartUtc, now),
            CartsPerMonth(carts, windowStartUtc, now));
    }

    // The non-organizer roster plus any ledger person no longer on it (whose name
    // falls back to the id), ordered by display name then id.
    private static List<InsightsMember> BuildMembers(
        IReadOnlyList<PersonEntity> people,
        HashSet<string> organizerIds,
        List<ChoreCompletionEntity> memberRows)
    {
        var byId = new Dictionary<string, InsightsMember>(StringComparer.Ordinal);
        foreach (var person in people.Where(person => !organizerIds.Contains(person.RowKey)))
        {
            byId[person.RowKey] = new InsightsMember(person.RowKey, person.DisplayName, person.ClaimColor);
        }

        foreach (var row in memberRows)
        {
            byId.TryAdd(row.PersonId, new InsightsMember(row.PersonId, row.PersonId, null));
        }

        return byId.Values
            .OrderBy(member => member.DisplayName, StringComparer.Ordinal)
            .ThenBy(member => member.PersonId, StringComparer.Ordinal)
            .ToList();
    }

    private static WeeklyInsight BuildWeek(
        string weekIso,
        List<InsightsMember> members,
        IEnumerable<ChoreCompletionEntity> rows)
    {
        var effort = new Dictionary<string, int>(StringComparer.Ordinal);
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            // A reversal row already carries the negated effort; it also cancels
            // the completion it undoes in the count.
            effort[row.PersonId] = effort.GetValueOrDefault(row.PersonId) + row.Effort;
            var delta = row.RowKey.EndsWith(ReversalSuffix, StringComparison.Ordinal) ? -1 : 1;
            counts[row.PersonId] = counts.GetValueOrDefault(row.PersonId) + delta;
        }

        var total = effort.Values.Sum();
        string? topPersonId = null;
        var share = 0d;
        if (total > 0)
        {
            var top = effort
                .OrderByDescending(pair => pair.Value)
                .ThenBy(pair => pair.Key, StringComparer.Ordinal)
                .First();
            topPersonId = top.Key;
            share = (double)top.Value / total;
        }

        var completions = members
            .Select(member => new MemberCompletions(
                member.PersonId,
                Math.Max(0, counts.GetValueOrDefault(member.PersonId))))
            .ToList();

        return new WeeklyInsight(weekIso, total, topPersonId, share, completions);
    }

    // Hub glances per UTC day from the window's first Monday through today,
    // zero-filled. Events outside the window (or after now) are ignored.
    private static List<DailyCount> GlancesPerDay(
        IReadOnlyList<EventEntity> events,
        DateTimeOffset windowStartUtc,
        DateTimeOffset now)
    {
        var counts = events
            .Where(entity => string.Equals(entity.Type, EventTypes.HubGlanced, StringComparison.Ordinal)
                && entity.OccurredUtc >= windowStartUtc
                && entity.OccurredUtc <= now)
            .GroupBy(entity => DateOnly.FromDateTime(entity.OccurredUtc.UtcDateTime))
            .ToDictionary(group => group.Key, group => group.Count());

        var firstDay = DateOnly.FromDateTime(windowStartUtc.UtcDateTime);
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        var days = new List<DailyCount>();
        for (var day = firstDay; day <= today; day = day.AddDays(1))
        {
            days.Add(new DailyCount(
                day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                counts.GetValueOrDefault(day)));
        }

        return days;
    }

    // Confirmed carts per UTC month from the window-start month through the
    // current month, zero-filled. Only carts confirmed inside [windowStart, now]
    // count.
    private static List<MonthlyCount> CartsPerMonth(
        IReadOnlyList<CartEntity> carts,
        DateTimeOffset windowStartUtc,
        DateTimeOffset now)
    {
        var counts = carts
            .Where(cart => string.Equals(cart.Status, CartStatus.Confirmed, StringComparison.Ordinal))
            .Select(cart => cart.ConfirmedUtc)
            .OfType<DateTimeOffset>()
            .Where(confirmed => confirmed >= windowStartUtc && confirmed <= now)
            .GroupBy(confirmed => MonthKey(confirmed.UtcDateTime))
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);

        var startUtc = windowStartUtc.UtcDateTime;
        var nowUtc = now.UtcDateTime;
        var month = new DateTime(startUtc.Year, startUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var lastMonth = new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var months = new List<MonthlyCount>();
        for (; month <= lastMonth; month = month.AddMonths(1))
        {
            var key = MonthKey(month);
            months.Add(new MonthlyCount(key, counts.GetValueOrDefault(key)));
        }

        return months;
    }

    private static string MonthKey(DateTime utc) =>
        utc.ToString("yyyy-MM", CultureInfo.InvariantCulture);
}
