using System.Net;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Capture;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Tests.TestSupport;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Capture;

/// <summary>
/// Criterion (G3): ambiguous or no-match input returns a clear, structured result -
/// candidate suggestions or an RFC 7807 problem detail - and never throws an
/// unhandled exception. Every case below comes back as a <c>4xx</c> problem
/// document with the term Butler thought it heard, and none of them adds a line to
/// the cart.
/// </summary>
public sealed class AmbiguousCaptureTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public AmbiguousCaptureTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task An_ambiguous_utterance_returns_the_candidates_as_suggestions()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W45";

        // "milk" matches whole milk, 2% milk, and oat milk in the fixture catalog,
        // and none of them is an exact display-name hit - so v1 asks rather than
        // guessing one into the cart.
        using var response = await CaptureTestHelper.PostAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add milk", personId = "person-20", weekIso = week });

        var problem = await CaptureTestHelper.AssertProblemAsync(
            response, HttpStatusCode.BadRequest, "The utterance matched more than one product.");

        Assert.Equal(CaptureSourceNames.HubText, problem.GetProperty("captureSource").GetString());
        Assert.Equal("milk", problem.GetProperty("resolvedTerm").GetString());

        var suggestions = problem.GetProperty("suggestions").EnumerateArray().ToArray();
        Assert.True(suggestions.Length >= 2, $"Expected several candidates but got {suggestions.Length}.");
        Assert.All(suggestions, suggestion =>
        {
            Assert.False(string.IsNullOrWhiteSpace(suggestion.GetProperty("productId").GetString()));
            Assert.False(string.IsNullOrWhiteSpace(suggestion.GetProperty("displayName").GetString()));
            Assert.Equal("simulated-heb", suggestion.GetProperty("sourceConnector").GetString());
        });

        // Nothing was added: the week's cart exists (get-or-create) but is empty.
        var cart = await CaptureTestHelper.GetCartAsync(client, householdId, week);
        Assert.Empty(cart.GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task An_utterance_the_store_cannot_match_is_a_404()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W46";

        using var response = await CaptureTestHelper.PostAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add unicorn steaks", personId = "person-21", weekIso = week });

        var problem = await CaptureTestHelper.AssertProblemAsync(
            response, HttpStatusCode.NotFound, "No product matched.");
        Assert.Equal("unicorn steaks", problem.GetProperty("resolvedTerm").GetString());
        Assert.Empty(problem.GetProperty("suggestions").EnumerateArray());

        var cart = await CaptureTestHelper.GetCartAsync(client, householdId, week);
        Assert.Empty(cart.GetProperty("items").EnumerateArray());
    }

    [Theory]
    [InlineData("add")]
    [InlineData("please add some")]
    [InlineData("add to the cart")]
    [InlineData("")]
    public async Task An_utterance_with_no_product_term_is_a_400(string utterance)
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);

        using var response = await CaptureTestHelper.PostAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance, personId = "person-22", weekIso = "2026-W47" });

        var problem = await CaptureTestHelper.AssertProblemAsync(
            response, HttpStatusCode.BadRequest, "No product was recognised in the utterance.");
        Assert.Equal(string.Empty, problem.GetProperty("resolvedTerm").GetString());
    }

    [Fact]
    public async Task An_empty_body_is_a_400_rather_than_a_500()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);

        // No utterance and no actor at all: still a problem document, never an
        // unhandled exception.
        using var response = await CaptureTestHelper.PostAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { });

        await CaptureTestHelper.AssertProblemAsync(
            response, HttpStatusCode.BadRequest, "A person is required to add to the cart.");
    }

    [Fact]
    public async Task No_body_at_all_is_a_400_rather_than_a_500()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);

        // Not even a JSON document: the route allows an empty body, so there is no
        // actor to attribute anything to.
        using var response = await CaptureTestHelper.PostEmptyAsync(
            client, CaptureTestHelper.TextRoute(householdId));

        await CaptureTestHelper.AssertProblemAsync(
            response, HttpStatusCode.BadRequest, "A person is required to add to the cart.");
    }

    [Fact]
    public async Task A_participant_session_with_no_body_says_nothing_was_recognised()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        var token = ParticipantSession.Encode(householdId, Guid.NewGuid().ToString("N"));

        // The session supplies the actor, so the capture gets as far as the
        // handler - which finds no utterance and says so.
        using var response = await CaptureTestHelper.PostEmptyAsync(
            client, CaptureTestHelper.VoiceRoute(householdId), token);

        await CaptureTestHelper.AssertProblemAsync(
            response, HttpStatusCode.BadRequest, "No product was recognised in the utterance.");
    }

    [Fact]
    public async Task An_unknown_household_is_a_404()
    {
        using var client = _factory.CreateClient();
        var unknown = Guid.NewGuid().ToString("N");

        using var response = await CaptureTestHelper.PostAsync(
            client,
            CaptureTestHelper.TextRoute(unknown),
            new { utterance = "add eggs", personId = "person-23" });

        await CaptureTestHelper.AssertProblemAsync(
            response, HttpStatusCode.NotFound, "Household not found.");
    }

    [Fact]
    public async Task Capturing_into_an_already_confirmed_week_is_a_409()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W48";

        // Create the week's cart, then flip it to Confirmed on the same seam G4
        // uses. A confirmed cart accepts no more items - and says so as a 409
        // rather than as a 500.
        await CaptureTestHelper.GetCurrentCartAsync(client, householdId, week);
        var carts = _factory.Services.GetRequiredService<ICartRepository>();
        var stored = await carts.GetAsync(householdId, week, CancellationToken.None);
        stored!.Status = CartStatus.Confirmed;
        stored.ConfirmedByPersonId = "organizer-1";
        stored.ConfirmedUtc = new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero);
        await carts.UpdateAsync(householdId, stored, stored.ETag.ToString(), CancellationToken.None);

        using var response = await CaptureTestHelper.PostAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add eggs", personId = "person-24", weekIso = week });

        await CaptureTestHelper.AssertProblemAsync(
            response, HttpStatusCode.Conflict, "The week's cart is already confirmed.");
    }

    [Fact]
    public async Task A_malformed_week_is_a_400()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);

        using var response = await CaptureTestHelper.PostAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add eggs", personId = "person-25", weekIso = "not-a-week" });

        await CaptureTestHelper.AssertProblemAsync(
            response, HttpStatusCode.BadRequest, "Validation failed.");
    }

    [Fact]
    public async Task A_no_match_result_carries_no_suggestions_in_its_document()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);

        using var response = await CaptureTestHelper.PostAsync(
            client,
            CaptureTestHelper.VoiceRoute(householdId),
            new { utterance = "Butler, add caviar.", personId = "person-26", weekIso = "2026-W49" });

        var problem = await CaptureTestHelper.AssertProblemAsync(
            response, HttpStatusCode.NotFound, "No product matched.");
        Assert.Equal(CaptureSourceNames.SimulatedVoice, problem.GetProperty("captureSource").GetString());
        Assert.Equal(JsonValueKind.Array, problem.GetProperty("suggestions").ValueKind);
        Assert.Empty(problem.GetProperty("suggestions").EnumerateArray());
    }
}
