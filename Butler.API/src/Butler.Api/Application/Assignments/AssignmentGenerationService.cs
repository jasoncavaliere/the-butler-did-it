using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Concurrency;
using Butler.Api.Domain.Scheduling;
using Butler.Api.Infrastructure.Assignments;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Chores;
using Butler.Api.Infrastructure.Households;
using Butler.Api.Infrastructure.People;

namespace Butler.Api.Application.Assignments;

/// <summary>
/// Default <see cref="IAssignmentGenerationService"/> - the C3 composition that
/// turns a household's chores, people, and completion history into a persisted
/// week of assignments by running the pure C2 engine over data it fetched
/// (Engineering Contract 7.6). All I/O lives here so the engine stays a pure
/// function; time arrives through the injected <see cref="TimeProvider"/> seam so
/// week-bucketing and due dates stay deterministically testable (7.5).
/// </summary>
public sealed class AssignmentGenerationService : IAssignmentGenerationService
{
    // The fairness window: the target week plus the three preceding ISO weeks.
    private const int TrailingWeekCount = 4;

    private readonly IHouseholdRepository _households;
    private readonly IChoreRepository _chores;
    private readonly IPersonRepository _people;
    private readonly IChoreCompletionRepository _completions;
    private readonly IAssignmentRepository _assignments;
    private readonly IFairAssignmentEngine _engine;
    private readonly TimeProvider _clock;

    public AssignmentGenerationService(
        IHouseholdRepository households,
        IChoreRepository chores,
        IPersonRepository people,
        IChoreCompletionRepository completions,
        IAssignmentRepository assignments,
        IFairAssignmentEngine engine,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(households);
        ArgumentNullException.ThrowIfNull(chores);
        ArgumentNullException.ThrowIfNull(people);
        ArgumentNullException.ThrowIfNull(completions);
        ArgumentNullException.ThrowIfNull(assignments);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(clock);
        _households = households;
        _chores = chores;
        _people = people;
        _completions = completions;
        _assignments = assignments;
        _engine = engine;
        _clock = clock;
    }

    /// <inheritdoc />
    public async Task<AssignmentSetResponse?> GenerateAsync(
        string householdId,
        string? weekIso,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(householdId);

        // Unknown household is a 404, not an empty generation.
        var household = await _households.GetAsync(householdId, cancellationToken).ConfigureAwait(false);
        if (household is null)
        {
            return null;
        }

        var targetWeek = ResolveWeek(weekIso);

        // The active chores are the only assignment candidates (H3); deactivated
        // chores are retained but never assigned.
        var activeChores = (await _chores.ListAsync(householdId, cancellationToken).ConfigureAwait(false))
            .Where(chore => chore.Active)
            .ToList();

        var people = await _people.ListAsync(householdId, cancellationToken).ConfigureAwait(false);

        // The week's existing assignments drive the idempotent regenerate rule:
        // Done chores are preserved and never re-assigned; Open rows are replaced.
        var existingForWeek = (await _assignments.ListAsync(householdId, cancellationToken).ConfigureAwait(false))
            .Where(assignment => string.Equals(assignment.WeekIso, targetWeek, StringComparison.Ordinal))
            .ToList();

        var doneAssignments = existingForWeek
            .Where(assignment => string.Equals(assignment.Status, AssignmentStatus.Done, StringComparison.Ordinal))
            .ToList();
        var doneChoreIds = doneAssignments
            .Select(assignment => ChoreIdOf(assignment))
            .ToHashSet(StringComparer.Ordinal);
        var openByChoreId = existingForWeek
            .Where(assignment => string.Equals(assignment.Status, AssignmentStatus.Open, StringComparison.Ordinal))
            .ToDictionary(ChoreIdOf, StringComparer.Ordinal);

        var trailingLoads = await ComputeTrailingLoadsAsync(householdId, targetWeek, cancellationToken)
            .ConfigureAwait(false);

        // Build the engine request: assignable chores are the active ones that are
        // not already completed this week, and every person carries their
        // trailing load (which already counts the current week's Done completions).
        var assignableChores = activeChores
            .Where(chore => !doneChoreIds.Contains(chore.RowKey))
            .Select(chore => new FairAssignmentChore(chore.RowKey, chore.Effort, chore.MinAge))
            .ToList();

        var requestPeople = people
            .Select(person => new FairAssignmentPerson(
                person.RowKey,
                person.IsChild,
                trailingLoads.GetValueOrDefault(person.RowKey)))
            .ToList();

        var result = _engine.Assign(new FairAssignmentRequest(assignableChores, requestPeople));

        var dueDateUtc = DueDateFor(targetWeek);
        await PersistAsync(householdId, targetWeek, dueDateUtc, result, openByChoreId, cancellationToken)
            .ConfigureAwait(false);

        return BuildResponse(targetWeek, result, doneAssignments, activeChores);
    }

    // A supplied week is validated (a malformed value is a client 400 via the
    // FormatException the parser throws); an omitted one comes from the clock.
    private string ResolveWeek(string? weekIso)
    {
        if (string.IsNullOrWhiteSpace(weekIso))
        {
            return WeekIso.For(_clock.GetUtcNow());
        }

        // Parse to validate the shape; a malformed value is a client error (400),
        // not the 500 a raw FormatException would map to.
        try
        {
            _ = WeekIso.StartOfWeekUtc(weekIso);
        }
        catch (FormatException ex)
        {
            throw new ValidationException(ex.Message);
        }

        return weekIso;
    }

    // Each person's trailing load is the sum of their completion effort over the
    // target week and the three preceding ISO weeks, read only from this
    // household's append-only ledger (no cross-household query).
    private async Task<Dictionary<string, int>> ComputeTrailingLoadsAsync(
        string householdId,
        string targetWeek,
        CancellationToken cancellationToken)
    {
        var window = TrailingWeekWindow(targetWeek);
        var completions = await _completions.ListAsync(householdId, cancellationToken).ConfigureAwait(false);

        var loads = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var completion in completions)
        {
            if (!window.Contains(completion.WeekIso))
            {
                continue;
            }

            loads[completion.PersonId] = loads.GetValueOrDefault(completion.PersonId) + completion.Effort;
        }

        return loads;
    }

    // The set of ISO weeks whose completions count toward the trailing load: the
    // target week and the three before it (so the current week's Done work is
    // reflected in the recomputed loads).
    private static HashSet<string> TrailingWeekWindow(string targetWeek)
    {
        var monday = WeekIso.StartOfWeekUtc(targetWeek);
        var window = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < TrailingWeekCount; i++)
        {
            window.Add(WeekIso.For(monday.AddDays(-7 * i)));
        }

        return window;
    }

    // A weekly chore is due at the end of its ISO week: Sunday 23:59 UTC.
    private static DateTimeOffset DueDateFor(string targetWeek) =>
        WeekIso.StartOfWeekUtc(targetWeek).AddDays(6).AddHours(23).AddMinutes(59);

    // Persist the engine's placements: an Open row for a chore is replaced in
    // place under a wildcard precondition; a chore with no row yet is added. Done
    // rows are never touched here - their chores were excluded from the request.
    private async Task PersistAsync(
        string householdId,
        string targetWeek,
        DateTimeOffset dueDateUtc,
        FairAssignmentResult result,
        Dictionary<string, AssignmentEntity> openByChoreId,
        CancellationToken cancellationToken)
    {
        foreach (var placement in result.Assignments)
        {
            if (openByChoreId.TryGetValue(placement.ChoreId, out var existing))
            {
                existing.AssignedPersonId = placement.PersonId;
                existing.WeekIso = targetWeek;
                existing.DueDateUtc = dueDateUtc;
                existing.Status = AssignmentStatus.Open;
                await _assignments
                    .UpdateAsync(householdId, existing, OptimisticConcurrency.Wildcard, cancellationToken)
                    .ConfigureAwait(false);
                continue;
            }

            var assignment = new AssignmentEntity
            {
                PartitionKey = householdId,
                RowKey = RowKeyFor(targetWeek, placement.ChoreId),
                AssignedPersonId = placement.PersonId,
                WeekIso = targetWeek,
                DueDateUtc = dueDateUtc,
                Status = AssignmentStatus.Open,
            };
            await _assignments.AddAsync(householdId, assignment, cancellationToken).ConfigureAwait(false);
        }
    }

    // The response is the full week: the freshly-placed Open assignments plus the
    // preserved Done ones, then the engine's unassigned chores - all ordered by
    // chore id for a deterministic payload.
    private static AssignmentSetResponse BuildResponse(
        string targetWeek,
        FairAssignmentResult result,
        IReadOnlyList<AssignmentEntity> doneAssignments,
        IReadOnlyList<ChoreEntity> activeChores)
    {
        var effortByChoreId = activeChores.ToDictionary(
            chore => chore.RowKey,
            chore => chore.Effort,
            StringComparer.Ordinal);

        var placed = result.Assignments
            .Select(assignment => new AssignmentView(
                assignment.ChoreId,
                assignment.PersonId,
                assignment.Effort,
                AssignmentStatus.Open))
            .Concat(doneAssignments.Select(done => new AssignmentView(
                ChoreIdOf(done),
                done.AssignedPersonId,
                effortByChoreId.GetValueOrDefault(ChoreIdOf(done)),
                AssignmentStatus.Done)))
            .OrderBy(view => view.ChoreId, StringComparer.Ordinal)
            .ToList();

        var unassigned = result.Unassigned
            .Select(chore => new UnassignedView(chore.ChoreId, chore.Effort, chore.Reason))
            .OrderBy(view => view.ChoreId, StringComparer.Ordinal)
            .ToList();

        return new AssignmentSetResponse(targetWeek, placed, unassigned);
    }

    // Assignment row keys are the {weekIso}_{choreId} composite (Contract 7.3).
    private static string RowKeyFor(string weekIso, string choreId) => $"{weekIso}_{choreId}";

    // Recover the choreId from an assignment's {weekIso}_{choreId} row key: the
    // week prefix has a fixed shape, so the chore id is everything after the
    // first underscore.
    private static string ChoreIdOf(AssignmentEntity assignment)
    {
        var separator = assignment.RowKey.IndexOf('_', StringComparison.Ordinal);
        return separator < 0 ? assignment.RowKey : assignment.RowKey[(separator + 1)..];
    }
}
