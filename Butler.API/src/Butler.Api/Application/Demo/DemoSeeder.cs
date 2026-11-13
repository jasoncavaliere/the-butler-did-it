using System.Globalization;
using Butler.Api.Application.Assignments;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Capture;
using Butler.Api.Application.Chores;
using Butler.Api.Application.Households;
using Butler.Api.Application.People;
using Butler.Api.Application.Rooms;
using Butler.Api.Domain.Scheduling;
using Butler.Api.Infrastructure.ChoreCompletions;
using Butler.Api.Infrastructure.Demo;
using Butler.Api.Infrastructure.Hosting;
using Microsoft.Extensions.Hosting;

namespace Butler.Api.Application.Demo;

/// <summary>
/// Default <see cref="IDemoSeeder"/>. It builds the demo household from the
/// <see cref="DemoHousehold"/> script through the same services the API uses
/// (households, rooms, people, chores, assignment generation, completion, and
/// capture). The one exception is the back-dated history: the completion service
/// stamps "now", so past weeks are appended straight to the completions ledger
/// repository with dates derived from the injected clock (Engineering Contract
/// 7.5).
/// </summary>
public sealed class DemoSeeder : IDemoSeeder
{
    // Back-dated completions land in the evening of their day.
    private const int HistoryHourOfDay = 18;

    private readonly IHostEnvironment _environment;
    private readonly TimeProvider _clock;
    private readonly IDemoHouseholdPurger _purger;
    private readonly IHouseholdService _households;
    private readonly IRoomService _rooms;
    private readonly IPersonService _people;
    private readonly IChoreService _chores;
    private readonly IChoreCompletionRepository _completions;
    private readonly IAssignmentGenerationService _assignments;
    private readonly IChoreCompletionService _completionService;
    private readonly ICaptureHandler _capture;

    public DemoSeeder(
        IHostEnvironment environment,
        TimeProvider clock,
        IDemoHouseholdPurger purger,
        IHouseholdService households,
        IRoomService rooms,
        IPersonService people,
        IChoreService chores,
        IChoreCompletionRepository completions,
        IAssignmentGenerationService assignments,
        IChoreCompletionService completionService,
        ICaptureHandler capture)
    {
        ArgumentNullException.ThrowIfNull(environment);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(purger);
        ArgumentNullException.ThrowIfNull(households);
        ArgumentNullException.ThrowIfNull(rooms);
        ArgumentNullException.ThrowIfNull(people);
        ArgumentNullException.ThrowIfNull(chores);
        ArgumentNullException.ThrowIfNull(completions);
        ArgumentNullException.ThrowIfNull(assignments);
        ArgumentNullException.ThrowIfNull(completionService);
        ArgumentNullException.ThrowIfNull(capture);
        _environment = environment;
        _clock = clock;
        _purger = purger;
        _households = households;
        _rooms = rooms;
        _people = people;
        _chores = chores;
        _completions = completions;
        _assignments = assignments;
        _completionService = completionService;
        _capture = capture;
    }

    /// <inheritdoc />
    public async Task<DemoSeedResponse> SeedAsync(
        string organizerObjectId,
        string? organizerDisplayName,
        CancellationToken cancellationToken = default)
    {
        // Refuse before any I/O outside Development and Demo.
        if (!_environment.IsDevelopmentOrDemo())
        {
            throw DemoSeedingNotAllowedException.ForEnvironment(_environment.EnvironmentName);
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(organizerObjectId);

        const string householdId = DemoHousehold.Id;

        // Every date comes from the injected clock: its ISO week is the current
        // week, and the history fills the three weeks before it (oldest first).
        var currentWeek = WeekIso.For(_clock.GetUtcNow());
        var currentMonday = WeekIso.StartOfWeekUtc(currentWeek);
        var historyWeeks = DemoHousehold.History
            .OrderByDescending(week => week.WeeksAgo)
            .Select(week => (Script: week, WeekIso: WeekIso.For(currentMonday.AddDays(-7 * week.WeeksAgo))))
            .ToList();

        // Replace semantics: wipe the previous demo household first. Both stores
        // reject a row key that already exists, so this must precede the create.
        await _purger.PurgeAsync(householdId, cancellationToken).ConfigureAwait(false);

        await _households
            .CreateWithIdAsync(householdId, DemoHousehold.Name, organizerObjectId, organizerDisplayName, cancellationToken)
            .ConfigureAwait(false);

        var roomIds = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var room in DemoHousehold.Rooms)
        {
            var created = await _rooms
                .CreateAsync(householdId, room.Name, room.SortOrder, cancellationToken)
                .ConfigureAwait(false);
            roomIds[room.Name] = created.RoomId;
        }

        // Every family member is a participant; the organizer row created with the
        // household stays hidden from chores and fairness.
        var personIds = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var person in DemoHousehold.People)
        {
            var created = await _people
                .CreateAsync(
                    householdId,
                    person.DisplayName,
                    OrganizerAuthorization.ParticipantRole,
                    person.IsChild,
                    person.ClaimColor,
                    cancellationToken)
                .ConfigureAwait(false);
            personIds[person.Key] = created.PersonId;
        }

        var chores = new Dictionary<int, (string ChoreId, int Effort)>();
        foreach (var chore in DemoHousehold.Chores)
        {
            var created = await _chores
                .CreateAsync(
                    householdId,
                    chore.Title,
                    roomIds[chore.RoomName],
                    chore.Cadence,
                    chore.Effort,
                    chore.MinAge,
                    cancellationToken)
                .ConfigureAwait(false);
            chores[chore.Number] = (created.ChoreId, created.Effort);
        }

        // History goes in before the current week is generated, so the engine's
        // trailing loads already include it.
        var completionCount = 0;
        foreach (var (script, weekIso) in historyWeeks)
        {
            var monday = WeekIso.StartOfWeekUtc(weekIso);
            foreach (var (choreNumber, personKey) in script.Completions)
            {
                var (choreId, effort) = chores[choreNumber];
                var completedUtc = monday
                    .AddDays((choreNumber - 1) % 7)
                    .AddHours(HistoryHourOfDay);
                await _completions
                    .AddAsync(
                        householdId,
                        new ChoreCompletionEntity
                        {
                            PartitionKey = householdId,
                            RowKey = string.Create(
                                CultureInfo.InvariantCulture,
                                $"{completedUtc.UtcTicks}_{choreId}"),
                            ChoreId = choreId,
                            PersonId = personIds[personKey],
                            CompletedUtc = completedUtc,
                            Effort = effort,
                            WeekIso = weekIso,
                        },
                        cancellationToken)
                    .ConfigureAwait(false);
                completionCount++;
            }
        }

        var generated = await _assignments.GenerateAsync(householdId, null, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException(
                $"Assignments could not be generated for the demo household '{householdId}'.");

        // A few of this week's chores are already done, by whoever got them.
        foreach (var choreNumber in DemoHousehold.CurrentWeekCompletedChores)
        {
            var choreId = chores[choreNumber].ChoreId;
            var assignment = generated.Assignments.Single(
                candidate => string.Equals(candidate.ChoreId, choreId, StringComparison.Ordinal));
            await _completionService
                .CompleteAsync(householdId, currentWeek, choreId, assignment.AssignedPersonId, cancellationToken)
                .ConfigureAwait(false);
            completionCount++;
        }

        foreach (var item in DemoHousehold.CartItems)
        {
            var result = await _capture
                .ResolveAndAddAsync(
                    CaptureSourceNames.HubText,
                    new CaptureRequest(householdId, item.DisplayName, personIds[item.AddedByKey], currentWeek),
                    cancellationToken)
                .ConfigureAwait(false);
            if (result.Outcome != CaptureOutcome.Added)
            {
                throw new InvalidOperationException(
                    $"Demo cart item '{item.DisplayName}' did not resolve to a single product ({result.Outcome}).");
            }
        }

        return new DemoSeedResponse(
            householdId,
            DemoHousehold.Name,
            currentWeek,
            historyWeeks.Select(week => week.WeekIso).ToList(),
            roomIds.Count,
            personIds.Count,
            chores.Count,
            completionCount,
            generated.Assignments.Count,
            DemoHousehold.CartItems.Count);
    }
}
