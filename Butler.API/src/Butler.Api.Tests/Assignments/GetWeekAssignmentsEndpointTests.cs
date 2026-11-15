using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Infrastructure.Assignments;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Butler.Api.Tests.Assignments;

/// <summary>
/// Criteria (issue #110), end to end through the real HTTP pipeline with a pinned
/// clock: <c>GET /households/{householdId}/assignments/{weekIso}</c> generates the
/// current week on its first read and returns it in the same <c>200</c>; a week
/// that already has rows, and any past or future week, is returned as stored and
/// never generated; concurrent first reads persist one set; and every response
/// carries the server's own week as <c>currentWeekIso</c>. POST generate still
/// regenerates as before. Persisted rows are read straight from the in-memory
/// assignments table the host uses.
/// </summary>
public sealed class GetWeekAssignmentsEndpointTests
{
    // A Wednesday in ISO week 2026-W29.
    private static readonly DateTimeOffset MidWeek29 = new(2026, 7, 15, 9, 0, 0, TimeSpan.Zero);
    private const string Week28 = "2026-W28";
    private const string Week29 = "2026-W29";
    private const string Week30 = "2026-W30";

    private static WebApplicationFactory<Program> CreateFactory(BarrierAssignmentRepository? barrier = null) =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton<TimeProvider>(new MutableClock(MidWeek29));
                if (barrier is not null)
                {
                    // Route the host's assignment reads through the barrier, over
                    // the real (in-memory) table.
                    services.RemoveAll<IAssignmentRepository>();
                    services.AddSingleton<IAssignmentRepository>(provider =>
                        barrier.Over(ActivatorUtilities.CreateInstance<TableAssignmentRepository>(provider)));
                }
            }));

    private static async Task<string> CreateHouseholdAsync(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri("/households", UriKind.Relative),
            new { name = "Home" });
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Created, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("householdId").GetString()!;
    }

    private static async Task<string> CreateRoomAsync(HttpClient client, string householdId)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/rooms", UriKind.Relative),
            new { name = "Kitchen", sortOrder = 1 });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("roomId").GetString()!;
    }

    private static async Task CreateChoreAsync(HttpClient client, string householdId, string roomId, string title, int effort)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/chores", UriKind.Relative),
            new { title, roomId, cadence = "Weekly", effort, minAge = (int?)null });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task CreateParticipantAsync(HttpClient client, string householdId, string displayName)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/people", UriKind.Relative),
            new { displayName, role = "Participant", isChild = false, claimColor = (string?)null });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // A household with one participant and the given chores, ready to generate.
    private static async Task<(string HouseholdId, string RoomId)> SeedAsync(HttpClient client, params string[] chores)
    {
        var householdId = await CreateHouseholdAsync(client);
        await CreateParticipantAsync(client, householdId, "Jamie");
        var roomId = await CreateRoomAsync(client, householdId);
        foreach (var chore in chores)
        {
            await CreateChoreAsync(client, householdId, roomId, chore, effort: 3);
        }

        return (householdId, roomId);
    }

    private static Uri ReadUri(string householdId, string week) =>
        new($"/households/{householdId}/assignments/{week}", UriKind.Relative);

    // GETs a week, asserts a 200, and returns the parsed body.
    private static async Task<JsonElement> ReadWeekAsync(HttpClient client, string householdId, string week)
    {
        using var response = await client.GetAsync(ReadUri(householdId, week));
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    private static List<string> ChoreIdsOf(JsonElement set) =>
        set.GetProperty("assignments").EnumerateArray()
            .Select(a => a.GetProperty("choreId").GetString()!)
            .ToList();

    // The household's persisted rows for one week, straight from the table.
    private static async Task<List<AssignmentEntity>> PersistedAsync(
        WebApplicationFactory<Program> factory, string householdId, string week) =>
        (await factory.Services.GetRequiredService<IAssignmentRepository>().ListAsync(householdId))
            .Where(row => row.WeekIso == week)
            .ToList();

    // RowKey -> ETag string, captured now: the in-memory table hands out live
    // references, so a later comparison must not read the same objects back.
    private static async Task<Dictionary<string, string>> EtagSnapshotAsync(
        WebApplicationFactory<Program> factory, string householdId, string week) =>
        (await PersistedAsync(factory, householdId, week))
            .ToDictionary(row => row.RowKey, row => row.ETag.ToString());

    [Fact]
    public async Task Reading_an_empty_current_week_generates_and_returns_it()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (householdId, _) = await SeedAsync(client, "Dishes", "Trash");

        var set = await ReadWeekAsync(client, householdId, Week29);

        Assert.Equal(Week29, set.GetProperty("weekIso").GetString());
        Assert.Equal(2, set.GetProperty("assignments").GetArrayLength());
        Assert.All(
            set.GetProperty("assignments").EnumerateArray(),
            a => Assert.Equal("Open", a.GetProperty("status").GetString()));
        Assert.Equal(2, (await PersistedAsync(factory, householdId, Week29)).Count);
    }

    [Fact]
    public async Task Reading_a_week_that_has_assignments_returns_them_without_regenerating()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (householdId, roomId) = await SeedAsync(client, "Dishes");
        var first = await ReadWeekAsync(client, householdId, Week29);
        var before = await EtagSnapshotAsync(factory, householdId, Week29);

        // A chore added after the week was generated would be placed by any
        // regenerate; a stored read must not pick it up or touch existing rows.
        await CreateChoreAsync(client, householdId, roomId, "Trash", effort: 2);
        var second = await ReadWeekAsync(client, householdId, Week29);

        Assert.Equal(ChoreIdsOf(first), ChoreIdsOf(second));
        Assert.Single(second.GetProperty("assignments").EnumerateArray());
        Assert.Equal(before, await EtagSnapshotAsync(factory, householdId, Week29));
    }

    [Fact]
    public async Task Reading_a_past_week_returns_what_is_stored_and_never_generates()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (householdId, roomId) = await SeedAsync(client, "Dishes");

        // W28 has a stored set (an explicit POST generate); W27 has none.
        using (var generate = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/assignments/generate", UriKind.Relative),
            new { weekIso = Week28 }))
        {
            Assert.Equal(HttpStatusCode.OK, generate.StatusCode);
        }

        var before = await EtagSnapshotAsync(factory, householdId, Week28);
        await CreateChoreAsync(client, householdId, roomId, "Trash", effort: 2);

        var stored = await ReadWeekAsync(client, householdId, Week28);
        Assert.Equal(Week28, stored.GetProperty("weekIso").GetString());
        Assert.Single(stored.GetProperty("assignments").EnumerateArray());
        Assert.Equal(before, await EtagSnapshotAsync(factory, householdId, Week28));

        var empty = await ReadWeekAsync(client, householdId, "2026-W27");
        Assert.Empty(empty.GetProperty("assignments").EnumerateArray());
        Assert.Empty(await PersistedAsync(factory, householdId, "2026-W27"));
    }

    [Fact]
    public async Task Reading_a_future_week_never_generates()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (householdId, _) = await SeedAsync(client, "Dishes");

        var set = await ReadWeekAsync(client, householdId, Week30);

        Assert.Equal(Week30, set.GetProperty("weekIso").GetString());
        Assert.Empty(set.GetProperty("assignments").EnumerateArray());
        Assert.Empty(await PersistedAsync(factory, householdId, Week30));
    }

    [Fact]
    public async Task Concurrent_first_reads_of_the_current_week_persist_one_set()
    {
        const int Readers = 4;
        var barrier = new BarrierAssignmentRepository();
        using var factory = CreateFactory(barrier);
        using var client = factory.CreateClient();
        var (householdId, _) = await SeedAsync(client, "Dishes", "Trash", "Vacuum");

        // Several first reads at once. The barrier holds each one's first
        // assignments read until all of them have read, so every reader sees
        // the empty week before any of them can write: without the lock and its
        // re-read, a second generate would add an existing RowKey (a 500).
        barrier.Arm(Readers);
        var responses = await Task.WhenAll(
            Enumerable.Range(0, Readers).Select(_ => client.GetAsync(ReadUri(householdId, Week29))));
        try
        {
            foreach (var response in responses)
            {
                var body = await response.Content.ReadAsStringAsync();
                Assert.True(response.StatusCode == HttpStatusCode.OK, body);
                using var doc = JsonDocument.Parse(body);
                Assert.Equal(3, doc.RootElement.GetProperty("assignments").GetArrayLength());
            }
        }
        finally
        {
            foreach (var response in responses)
            {
                response.Dispose();
            }
        }

        var rows = await PersistedAsync(factory, householdId, Week29);
        Assert.Equal(3, rows.Count);
        Assert.Equal(3, rows.Select(row => row.RowKey).Distinct(StringComparer.Ordinal).Count());

        // One reader generated; the rest returned its set. No row was rewritten.
        Assert.Equal(3, barrier.Adds);
        Assert.Equal(0, barrier.Updates);
    }

    // An IAssignmentRepository decorator whose next N ListAsync calls, once
    // armed, wait for each other, so N concurrent requests all observe the same
    // snapshot before any of them proceeds. It counts writes and otherwise passes
    // straight through to the wrapped repository.
    private sealed class BarrierAssignmentRepository
    {
        private readonly object _sync = new();
        private TaskCompletionSource _allArrived = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _pending;
        private int _adds;
        private int _updates;

        public int Adds => Volatile.Read(ref _adds);

        public int Updates => Volatile.Read(ref _updates);

        public void Arm(int readers)
        {
            lock (_sync)
            {
                _pending = readers;
                _allArrived = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            }
        }

        public IAssignmentRepository Over(IAssignmentRepository inner) => new Decorator(this, inner);

        private async Task<IReadOnlyList<AssignmentEntity>> ListAsync(
            IAssignmentRepository inner,
            string householdId,
            CancellationToken cancellationToken)
        {
            var rows = await inner.ListAsync(householdId, cancellationToken).ConfigureAwait(false);
            Task? wait = null;
            lock (_sync)
            {
                if (_pending > 0)
                {
                    wait = _allArrived.Task;
                    if (--_pending == 0)
                    {
                        _allArrived.SetResult();
                    }
                }
            }

            if (wait is not null)
            {
                await wait.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken).ConfigureAwait(false);
            }

            return rows;
        }

        private sealed class Decorator(BarrierAssignmentRepository barrier, IAssignmentRepository inner)
            : IAssignmentRepository
        {
            public Task AddAsync(string householdId, AssignmentEntity assignment, CancellationToken cancellationToken = default)
            {
                Interlocked.Increment(ref barrier._adds);
                return inner.AddAsync(householdId, assignment, cancellationToken);
            }

            public Task<AssignmentEntity?> GetAsync(string householdId, string rowKey, CancellationToken cancellationToken = default) =>
                inner.GetAsync(householdId, rowKey, cancellationToken);

            public Task<IReadOnlyList<AssignmentEntity>> ListAsync(string householdId, CancellationToken cancellationToken = default) =>
                barrier.ListAsync(inner, householdId, cancellationToken);

            public Task UpdateAsync(string householdId, AssignmentEntity assignment, string? ifMatch, CancellationToken cancellationToken = default)
            {
                Interlocked.Increment(ref barrier._updates);
                return inner.UpdateAsync(householdId, assignment, ifMatch, cancellationToken);
            }
        }
    }

    [Fact]
    public async Task Reading_the_current_week_with_no_active_chores_returns_empty_and_persists_nothing()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (householdId, _) = await SeedAsync(client);

        var set = await ReadWeekAsync(client, householdId, Week29);

        Assert.Empty(set.GetProperty("assignments").EnumerateArray());
        Assert.Empty(set.GetProperty("unassigned").EnumerateArray());
        Assert.Empty(await PersistedAsync(factory, householdId, Week29));
    }

    [Fact]
    public async Task Reading_the_current_week_with_no_eligible_members_returns_empty_and_persists_nothing()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        // No participant: only the organizer, who never does chores.
        var householdId = await CreateHouseholdAsync(client);
        var roomId = await CreateRoomAsync(client, householdId);
        await CreateChoreAsync(client, householdId, roomId, "Dishes", effort: 3);

        var set = await ReadWeekAsync(client, householdId, Week29);

        Assert.Empty(set.GetProperty("assignments").EnumerateArray());
        Assert.Empty(await PersistedAsync(factory, householdId, Week29));
    }

    [Fact]
    public async Task Post_generate_still_regenerates_after_a_lazy_read()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (householdId, roomId) = await SeedAsync(client, "Dishes");
        await ReadWeekAsync(client, householdId, Week29);
        await CreateChoreAsync(client, householdId, roomId, "Trash", effort: 2);

        using var response = await client.PostAsync(
            new Uri($"/households/{householdId}/assignments/generate", UriKind.Relative),
            content: null);

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal(Week29, doc.RootElement.GetProperty("weekIso").GetString());
        Assert.Equal(Week29, doc.RootElement.GetProperty("currentWeekIso").GetString());
        Assert.Equal(2, doc.RootElement.GetProperty("assignments").GetArrayLength());
        Assert.Equal(2, (await PersistedAsync(factory, householdId, Week29)).Count);

        // The next lazy read returns the regenerated set as stored.
        Assert.Equal(2, (await ReadWeekAsync(client, householdId, Week29)).GetProperty("assignments").GetArrayLength());
    }

    [Theory]
    [InlineData(Week28)]
    [InlineData(Week29)]
    [InlineData(Week30)]
    public async Task Every_read_carries_the_servers_current_week(string week)
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (householdId, _) = await SeedAsync(client, "Dishes");

        var set = await ReadWeekAsync(client, householdId, week);

        Assert.Equal(week, set.GetProperty("weekIso").GetString());
        Assert.Equal(Week29, set.GetProperty("currentWeekIso").GetString());
    }

    [Fact]
    public async Task Unknown_household_is_404_problem_details()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(ReadUri(Guid.NewGuid().ToString("N"), Week29));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(404, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("Household not found.", doc.RootElement.GetProperty("title").GetString());
    }

    [Fact]
    public async Task A_participant_session_is_forbidden()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        var token = ParticipantSession.Encode(householdId, Guid.NewGuid().ToString("N"));
        using var request = new HttpRequestMessage(HttpMethod.Get, ReadUri(householdId, Week29));
        request.Headers.TryAddWithoutValidation(ParticipantSession.HeaderName, token);

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Empty(await PersistedAsync(factory, householdId, Week29));
    }

    [Fact]
    public async Task A_paired_hub_device_may_read()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var (householdId, _) = await SeedAsync(client, "Dishes");

        using var pair = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/hub-devices/pair", UriKind.Relative),
            new { deviceName = "Kitchen hub" });
        Assert.Equal(HttpStatusCode.OK, pair.StatusCode);
        using var pairDoc = JsonDocument.Parse(await pair.Content.ReadAsStringAsync());
        var deviceToken = pairDoc.RootElement.GetProperty("token").GetString()!;

        using var request = new HttpRequestMessage(HttpMethod.Get, ReadUri(householdId, Week29));
        request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, deviceToken);

        using var response = await client.SendAsync(request);

        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        Assert.Single(doc.RootElement.GetProperty("assignments").EnumerateArray());
    }

    [Fact]
    public async Task A_malformed_week_is_a_400()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var response = await client.GetAsync(ReadUri(householdId, "nonsense"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
