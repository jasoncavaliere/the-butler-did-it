using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Grocery;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Infrastructure.People;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using NSubstitute;

namespace Butler.Api.Tests.Carts;

/// <summary>
/// Criteria (G4 - the human on the final tap, journey 6.4), end to end through the
/// real HTTP pipeline: <c>POST /households/{householdId}/carts/{weekIso}/confirm</c>
/// flips the reviewed cart to <c>Confirmed</c> with who confirmed it and when (from
/// the injected clock), under the cart's <c>If-Match</c> precondition; it is
/// organizer-only, so a tap-to-claim participant and the paired hub device are
/// <c>403</c> (BRD risk R-1); it is idempotent, so a replayed confirm is a no-op
/// success that cannot rewrite who confirmed; and - per decision D-8 - it places no
/// order and moves no money, so the store connector is never called.
/// </summary>
public sealed class ConfirmCartTests
{
    // A Wednesday in ISO week 2026-W29, and a later time to prove a second confirm
    // does not restamp ConfirmedUtc.
    private static readonly DateTimeOffset ConfirmedAt = new(2026, 7, 15, 8, 30, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset LaterThatDay = new(2026, 7, 15, 19, 45, 0, TimeSpan.Zero);
    private const string Week = "2026-W29";

    private static WebApplicationFactory<Program> CreateFactory(MutableClock clock) =>
        new ButlerApiFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton<TimeProvider>(clock);
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

    // The review read (AC1): the organizer's cart + items, carrying the ETag the
    // confirm hands back as If-Match.
    private static async Task<JsonElement> ReviewAsync(HttpClient client, string householdId)
    {
        using var response = await client.GetAsync(
            new Uri($"/households/{householdId}/carts/current?weekIso={Week}", UriKind.Relative));
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    private static async Task<HttpResponseMessage> ConfirmAsync(
        HttpClient client,
        string householdId,
        string? ifMatch,
        string week = Week,
        Action<HttpRequestMessage>? configure = null)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri($"/households/{householdId}/carts/{week}/confirm", UriKind.Relative));

        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        }

        configure?.Invoke(request);
        return await client.SendAsync(request);
    }

    private static async Task<JsonElement> ConfirmOkAsync(
        HttpClient client,
        string householdId,
        string? ifMatch)
    {
        using var response = await ConfirmAsync(client, householdId, ifMatch);
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    // The organizer's People row, seeded by household creation and bound to the
    // caller's object id (Engineering Contract 7.4) - the person a confirm is
    // attributed to.
    private static async Task<string> OrganizerPersonIdAsync(
        WebApplicationFactory<Program> factory,
        string householdId)
    {
        var people = factory.Services.GetRequiredService<IPersonRepository>();
        var roster = await people.ListAsync(householdId, CancellationToken.None);
        var organizer = Assert.Single(
            roster,
            person => person.OrganizerObjectId == OrganizerAuthorization.DevOrganizerSubject);
        return organizer.RowKey;
    }

    [Fact]
    public async Task Confirm_sets_status_who_and_when_from_the_injected_clock()
    {
        var clock = new MutableClock(ConfirmedAt);
        using var factory = CreateFactory(clock);
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        // The organizer reviews the building cart, which has a line on it.
        var items = factory.Services.GetRequiredService<ICartItemRepository>();
        var review = await ReviewAsync(client, householdId);
        await items.AddAsync(
            householdId,
            new CartItemEntity
            {
                RowKey = CartItemEntity.RowKeyFor(Week, "item-1"),
                CartWeekIso = Week,
                ItemId = "item-1",
                ProductId = "heb-oat-milk",
                DisplayName = "Oat Milk",
                Quantity = 1,
                AddedByPersonId = "person-7",
                SourceConnector = "simulated-heb",
            },
            CancellationToken.None);

        var confirmed = await ConfirmOkAsync(client, householdId, review.GetProperty("eTag").GetString());

        Assert.Equal(Week, confirmed.GetProperty("weekIso").GetString());
        Assert.Equal(CartStatus.Confirmed, confirmed.GetProperty("status").GetString());
        Assert.Equal(
            await OrganizerPersonIdAsync(factory, householdId),
            confirmed.GetProperty("confirmedByPersonId").GetString());
        Assert.Equal(ConfirmedAt, confirmed.GetProperty("confirmedUtc").GetDateTimeOffset());
        // The confirmation is reviewable: it comes back as cart + items, and its
        // ETag is the new persisted version rather than the pre-confirm one.
        Assert.Equal("Oat Milk", Assert.Single(
            confirmed.GetProperty("items").EnumerateArray().ToArray()).GetProperty("displayName").GetString());
        Assert.NotEqual(review.GetProperty("eTag").GetString(), confirmed.GetProperty("eTag").GetString());

        // And it is what was actually persisted, not just what was rendered.
        var carts = factory.Services.GetRequiredService<ICartRepository>();
        var stored = await carts.GetAsync(householdId, Week, CancellationToken.None);
        Assert.Equal(CartStatus.Confirmed, stored!.Status);
        Assert.Equal(
            await OrganizerPersonIdAsync(factory, householdId),
            stored.ConfirmedByPersonId);
        Assert.Equal(ConfirmedAt, stored.ConfirmedUtc);
    }

    [Fact]
    public async Task A_second_confirm_is_an_idempotent_no_op()
    {
        var clock = new MutableClock(ConfirmedAt);
        using var factory = CreateFactory(clock);
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var review = await ReviewAsync(client, householdId);
        var reviewETag = review.GetProperty("eTag").GetString();

        var first = await ConfirmOkAsync(client, householdId, reviewETag);

        // The clock moves on and the organizer taps Confirm again, replaying the
        // pre-confirm If-Match it still holds. Nothing is written, so the stale
        // precondition is never consulted (no 412) and who/when stand.
        clock.Set(LaterThatDay);
        var second = await ConfirmOkAsync(client, householdId, reviewETag);

        Assert.Equal(CartStatus.Confirmed, second.GetProperty("status").GetString());
        Assert.Equal(
            first.GetProperty("confirmedByPersonId").GetString(),
            second.GetProperty("confirmedByPersonId").GetString());
        Assert.Equal(ConfirmedAt, second.GetProperty("confirmedUtc").GetDateTimeOffset());
        // A no-op writes nothing at all, so even the version stamp is untouched.
        Assert.Equal(first.GetProperty("eTag").GetString(), second.GetProperty("eTag").GetString());
    }

    [Fact]
    public async Task Confirming_places_no_order_and_moves_no_money()
    {
        var clock = new MutableClock(ConfirmedAt);
        var store = Substitute.For<IStoreConnector>();
        using var factory = new ButlerApiFactory().WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton<TimeProvider>(clock);
                services.RemoveAll<IStoreConnector>();
                services.AddSingleton(store);
            }));
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var review = await ReviewAsync(client, householdId);

        var confirmed = await ConfirmOkAsync(client, householdId, review.GetProperty("eTag").GetString());

        Assert.Equal(CartStatus.Confirmed, confirmed.GetProperty("status").GetString());
        // Decision D-8: the confirm records intent only. The store connector - the
        // one seam in Butler that could ever place an order - was never asked for
        // anything, and there is no payment seam to call at all.
        Assert.Empty(store.ReceivedCalls());
    }

    [Fact]
    public async Task A_participant_session_cannot_confirm()
    {
        var clock = new MutableClock(ConfirmedAt);
        using var factory = CreateFactory(clock);
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var review = await ReviewAsync(client, householdId);
        var token = ParticipantSession.Encode(householdId, Guid.NewGuid().ToString("N"));

        using var response = await ConfirmAsync(
            client,
            householdId,
            review.GetProperty("eTag").GetString(),
            configure: request =>
                request.Headers.TryAddWithoutValidation(ParticipantSession.HeaderName, token));

        // Authenticated as a participant (so not a 401 challenge) but not an organizer.
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await AssertStillBuildingAsync(factory, householdId);
    }

    [Fact]
    public async Task A_paired_hub_device_cannot_confirm()
    {
        var clock = new MutableClock(ConfirmedAt);
        using var factory = CreateFactory(clock);
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var review = await ReviewAsync(client, householdId);

        using var pairResponse = await client.PostAsJsonAsync(
            new Uri($"/households/{householdId}/hub-devices/pair", UriKind.Relative),
            new { deviceName = "Kitchen hub" });
        var pairBody = await pairResponse.Content.ReadAsStringAsync();
        Assert.True(pairResponse.StatusCode == HttpStatusCode.OK, pairBody);
        using var pairDoc = JsonDocument.Parse(pairBody);
        var deviceToken = pairDoc.RootElement.GetProperty("token").GetString()!;

        using var response = await ConfirmAsync(
            client,
            householdId,
            review.GetProperty("eTag").GetString(),
            configure: request =>
                request.Headers.TryAddWithoutValidation(DeviceToken.HeaderName, deviceToken));

        // The hub tablet may build and review the cart; the final tap is the
        // organizer's (Engineering Contract 7.4, mitigating risk R-1).
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await AssertStillBuildingAsync(factory, householdId);
    }

    [Fact]
    public async Task An_unauthenticated_caller_is_challenged_when_authentication_is_enabled()
    {
        using var factory = new ButlerApiFactory().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(Environments.Production);
            builder.UseSetting("Authentication:DisableAuthentication", "false");
            builder.UseSetting(
                "Authentication:Authority",
                "https://login.example.com/00000000-0000-0000-0000-000000000000/v2.0");
            builder.UseSetting("Authentication:Audience", "api://butler-test");
        });
        using var client = factory.CreateClient();

        using var response = await ConfirmAsync(client, Guid.NewGuid().ToString("N"), "*");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task An_unknown_household_and_a_week_with_no_cart_are_distinct_404s()
    {
        var clock = new MutableClock(ConfirmedAt);
        using var factory = CreateFactory(clock);
        using var client = factory.CreateClient();

        using var unknownHousehold = await ConfirmAsync(client, Guid.NewGuid().ToString("N"), "*");
        await AssertProblemAsync(unknownHousehold, HttpStatusCode.NotFound, "Household not found.");

        // The household exists, but nothing has ever built a cart for that week.
        var householdId = await CreateHouseholdAsync(client);
        using var noCart = await ConfirmAsync(client, householdId, "*", week: "2026-W02");
        await AssertProblemAsync(noCart, HttpStatusCode.NotFound, "Cart not found.");
    }

    [Fact]
    public async Task Confirm_carries_the_cart_version_it_reviewed()
    {
        var clock = new MutableClock(ConfirmedAt);
        using var factory = CreateFactory(clock);
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var review = await ReviewAsync(client, householdId);

        // No precondition at all: the caller never said which version it meant.
        using var missing = await ConfirmAsync(client, householdId, ifMatch: null);
        await AssertProblemAsync(
            missing, HttpStatusCode.PreconditionRequired, "If-Match header is required.");

        // The cart moved on (a line was added) after the review, so the version the
        // organizer reviewed is stale: re-read before confirming.
        var carts = factory.Services.GetRequiredService<ICartRepository>();
        var stored = await carts.GetAsync(householdId, Week, CancellationToken.None);
        await carts.UpdateAsync(householdId, stored!, stored!.ETag.ToString(), CancellationToken.None);

        using var stale = await ConfirmAsync(client, householdId, review.GetProperty("eTag").GetString());
        await AssertProblemAsync(
            stale,
            HttpStatusCode.PreconditionFailed,
            "The resource was modified by another request.");

        await AssertStillBuildingAsync(factory, householdId);
    }

    [Fact]
    public async Task A_malformed_week_is_a_400()
    {
        var clock = new MutableClock(ConfirmedAt);
        using var factory = CreateFactory(clock);
        using var client = factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var response = await ConfirmAsync(client, householdId, "*", week: "2026-W99");

        await AssertProblemAsync(response, HttpStatusCode.BadRequest, "Validation failed.");
    }

    private static async Task AssertStillBuildingAsync(
        WebApplicationFactory<Program> factory,
        string householdId)
    {
        var carts = factory.Services.GetRequiredService<ICartRepository>();
        var stored = await carts.GetAsync(householdId, Week, CancellationToken.None);
        Assert.Equal(CartStatus.Building, stored!.Status);
        Assert.Null(stored.ConfirmedByPersonId);
        Assert.Null(stored.ConfirmedUtc);
    }

    private static async Task AssertProblemAsync(
        HttpResponseMessage response,
        HttpStatusCode expectedStatus,
        string expectedTitle)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == expectedStatus, body);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal((int)expectedStatus, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal(expectedTitle, doc.RootElement.GetProperty("title").GetString());
    }
}
