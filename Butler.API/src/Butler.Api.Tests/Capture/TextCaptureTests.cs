using System.Net;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Capture;
using Butler.Api.Application.Grocery;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Capture;

/// <summary>
/// Criteria (G3), end to end through the real HTTP pipeline: a matching utterance
/// typed at the hub resolves through the G1 connector and adds the expected item
/// to the household's building cart (G2 get-or-create) with <c>Quantity</c>
/// defaulting to <c>1</c>, <c>AddedByPersonId</c> from the active participant/hub
/// session, and the <c>SourceConnector</c> carried off the resolved product. The
/// default factory runs in Development, so the ambient caller is the dev
/// organizer - which is exactly the shared-tablet case where the acting person
/// arrives in the body.
/// </summary>
public sealed class TextCaptureTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public TextCaptureTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task A_matching_utterance_adds_the_resolved_product_to_the_building_cart()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W30";

        var captured = await CaptureTestHelper.CaptureAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add oat milk", personId = "person-1", weekIso = week });

        // The response echoes what Butler heard and which source heard it.
        Assert.Equal(CaptureSourceNames.HubText, captured.GetProperty("captureSource").GetString());
        Assert.Equal("oat milk", captured.GetProperty("resolvedTerm").GetString());
        Assert.Equal(week, captured.GetProperty("weekIso").GetString());

        var item = captured.GetProperty("item");
        Assert.Equal("H-E-B Oat Milk", item.GetProperty("displayName").GetString());
        Assert.Equal("heb-0017", item.GetProperty("productId").GetString());
        Assert.Equal(1, item.GetProperty("quantity").GetInt32());
        Assert.Equal("person-1", item.GetProperty("addedByPersonId").GetString());
        Assert.Equal(SimulatedHebConnector.SourceName, item.GetProperty("sourceConnector").GetString());

        // ... and the line is really in the week's cart, not just in the response.
        var cart = await CaptureTestHelper.GetCartAsync(client, householdId, week);
        var line = Assert.Single(cart.GetProperty("items").EnumerateArray().ToArray());
        Assert.Equal(item.GetProperty("itemId").GetString(), line.GetProperty("itemId").GetString());
        Assert.Equal("H-E-B Oat Milk", line.GetProperty("displayName").GetString());
        Assert.Equal(1, line.GetProperty("quantity").GetInt32());
        Assert.Equal("person-1", line.GetProperty("addedByPersonId").GetString());
        Assert.Equal(SimulatedHebConnector.SourceName, line.GetProperty("sourceConnector").GetString());
    }

    [Fact]
    public async Task An_utterance_with_no_week_adds_to_the_current_weeks_cart()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);

        var captured = await CaptureTestHelper.CaptureAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "eggs", personId = "person-2" });

        // The week comes from the injected clock via G2, so the item lands in
        // whatever week "current" resolves to - and the current-cart read shows it.
        var week = captured.GetProperty("weekIso").GetString();
        Assert.False(string.IsNullOrWhiteSpace(week));

        var cart = await CaptureTestHelper.GetCurrentCartAsync(client, householdId);
        Assert.Equal(week, cart.GetProperty("weekIso").GetString());
        var line = Assert.Single(cart.GetProperty("items").EnumerateArray().ToArray());
        Assert.Equal("H-E-B Grade A Large Eggs", line.GetProperty("displayName").GetString());
    }

    [Fact]
    public async Task An_explicit_quantity_is_honoured()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);

        var captured = await CaptureTestHelper.CaptureAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add peanut butter", personId = "person-3", weekIso = "2026-W31", quantity = 3 });

        Assert.Equal(3, captured.GetProperty("item").GetProperty("quantity").GetInt32());
    }

    [Fact]
    public async Task A_participant_session_attributes_the_item_to_itself()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        var personId = Guid.NewGuid().ToString("N");
        var token = ParticipantSession.Encode(householdId, personId);

        // No personId in the body: the session identifies the actor (D-3), and no
        // organizer authority is required to add to the cart.
        var captured = await CaptureTestHelper.CaptureAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add bread", weekIso = "2026-W32" },
            token);

        Assert.Equal(personId, captured.GetProperty("item").GetProperty("addedByPersonId").GetString());
    }

    [Fact]
    public async Task A_capture_with_no_resolvable_actor_is_a_400()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);

        using var response = await CaptureTestHelper.PostAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add bread", weekIso = "2026-W32" });

        await CaptureTestHelper.AssertProblemAsync(
            response, HttpStatusCode.BadRequest, "A person is required to add to the cart.");
    }

    [Fact]
    public async Task Adding_an_item_advances_the_carts_version_stamp()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W33";

        var before = await CaptureTestHelper.GetCurrentCartAsync(client, householdId, week);
        await CaptureTestHelper.CaptureAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add rice", personId = "person-4", weekIso = week });
        var after = await CaptureTestHelper.GetCurrentCartAsync(client, householdId, week);

        // The cart's contents changed, so its optimistic-concurrency version moved
        // with them: an organizer holding the old ETag must re-read before a G4
        // confirm rather than confirming a cart that grew underneath them.
        Assert.NotEqual(
            before.GetProperty("eTag").GetString(),
            after.GetProperty("eTag").GetString());
    }

    [Fact]
    public async Task Two_utterances_add_two_lines()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W34";

        await CaptureTestHelper.CaptureAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add rice", personId = "person-5", weekIso = week });
        await CaptureTestHelper.CaptureAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add black beans", personId = "person-6", weekIso = week });

        var cart = await CaptureTestHelper.GetCartAsync(client, householdId, week);
        var lines = cart.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(2, lines.Length);
        Assert.Contains(lines, line => line.GetProperty("displayName").GetString() == "H-E-B Long Grain White Rice");
        Assert.Contains(lines, line => line.GetProperty("displayName").GetString() == "H-E-B Black Beans");
    }

    [Theory]
    [InlineData(null, "")]
    [InlineData("", "")]
    [InlineData("   ", "")]
    [InlineData("  oat milk  ", "oat milk")]
    [InlineData("add oat milk", "add oat milk")]
    public void The_hub_text_source_normalizes_whitespace_only(string? typed, string expected)
    {
        // Typed input carries no transport artefacts, so this source trims and
        // leaves term extraction to the shared normalizer.
        Assert.Equal(expected, HubTextCaptureSource.NormalizeTypedText(typed));
    }

    [Fact]
    public async Task The_hub_text_source_guards_its_inputs()
    {
        Assert.Throws<ArgumentNullException>(() => new HubTextCaptureSource(null!));

        var source = new HubTextCaptureSource(new StubCaptureHandler());
        Assert.Equal(CaptureSourceNames.HubText, source.SourceName);
        await Assert.ThrowsAsync<ArgumentNullException>(
            () => source.CaptureAsync(null!, CancellationToken.None));
    }

    // Minimal shared-handler stand-in for the guard test.
    private sealed class StubCaptureHandler : ICaptureHandler
    {
        public Task<CaptureResult> ResolveAndAddAsync(
            string captureSource,
            CaptureRequest request,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(CaptureResult.EmptyTerm(captureSource));
    }
}
