using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Application.Carts;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Tests.Capture;
using Butler.Api.Tests.TestSupport;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Butler.Api.Tests.Carts;

/// <summary>
/// Criteria (#113), end to end through the real HTTP pipeline:
/// <c>POST /households/{householdId}/carts/{weekIso}/items</c> adds a custom item
/// (a name the catalog could not match) to the week's building cart, open to any
/// authenticated caller like capture. The line reads back marked custom with no
/// product id and no price, the cart read totals its catalog lines and counts its
/// custom ones, and the confirmed cart (the D-8 order intent) keeps them.
/// </summary>
public sealed class CustomCartItemTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public CustomCartItemTests(ButlerApiFactory factory) => _factory = factory;

    private static Uri ItemsRoute(string householdId, string weekIso) =>
        new($"/households/{householdId}/carts/{weekIso}/items", UriKind.Relative);

    private static async Task<JsonElement> AddCustomAsync(
        HttpClient client,
        string householdId,
        string weekIso,
        object body,
        string? participantToken = null)
    {
        using var response = await CaptureTestHelper.PostAsync(
            client, ItemsRoute(householdId, weekIso), body, participantToken);
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Created, text);
        Assert.Equal(
            $"/households/{householdId}/carts/{weekIso}",
            response.Headers.Location?.AbsolutePath);
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.Clone();
    }

    private async Task ConfirmWeekInStorageAsync(string householdId, string week)
    {
        var carts = _factory.Services.GetRequiredService<ICartRepository>();
        var stored = await carts.GetAsync(householdId, week, CancellationToken.None);
        stored!.Status = CartStatus.Confirmed;
        stored.ConfirmedByPersonId = "organizer-1";
        stored.ConfirmedUtc = new DateTimeOffset(2026, 11, 26, 12, 0, 0, TimeSpan.Zero);
        await carts.UpdateAsync(householdId, stored, stored.ETag.ToString(), CancellationToken.None);
    }

    private static async Task<HttpResponseMessage> ConfirmAsync(
        HttpClient client,
        string householdId,
        string week,
        string? ifMatch)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri($"/households/{householdId}/carts/{week}/confirm", UriKind.Relative));
        request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task A_custom_item_is_added_and_reads_back_in_the_cart()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W10";

        var item = await AddCustomAsync(
            client, householdId, week, new { displayName = "  unicorn steaks  ", personId = "person-1" });

        // The name is trimmed, the quantity defaults to one, and the line carries
        // no product id and no price.
        Assert.Equal("unicorn steaks", item.GetProperty("displayName").GetString());
        Assert.Equal(1, item.GetProperty("quantity").GetInt32());
        Assert.Equal("person-1", item.GetProperty("addedByPersonId").GetString());
        Assert.Equal(CartItemSources.Custom, item.GetProperty("sourceConnector").GetString());
        Assert.True(item.GetProperty("isCustom").GetBoolean());
        Assert.Equal(JsonValueKind.Null, item.GetProperty("productId").ValueKind);
        Assert.Equal(JsonValueKind.Null, item.GetProperty("indicativePrice").ValueKind);

        var cart = await CaptureTestHelper.GetCartAsync(client, householdId, week);
        var line = Assert.Single(cart.GetProperty("items").EnumerateArray().ToArray());
        Assert.Equal(item.GetProperty("itemId").GetString(), line.GetProperty("itemId").GetString());
        Assert.Equal("unicorn steaks", line.GetProperty("displayName").GetString());
        Assert.True(line.GetProperty("isCustom").GetBoolean());
        Assert.Equal(JsonValueKind.Null, line.GetProperty("productId").ValueKind);
        Assert.Equal(JsonValueKind.Null, line.GetProperty("indicativePrice").ValueKind);
        Assert.Equal(1, cart.GetProperty("customItemCount").GetInt32());
        Assert.Equal(0m, cart.GetProperty("estimatedTotal").GetDecimal());
    }

    [Fact]
    public async Task An_explicit_quantity_is_honoured_and_a_non_positive_one_is_one()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W11";

        var three = await AddCustomAsync(
            client, householdId, week, new { displayName = "birthday candles", personId = "person-2", quantity = 3 });
        var zero = await AddCustomAsync(
            client, householdId, week, new { displayName = "party hats", personId = "person-2", quantity = 0 });

        Assert.Equal(3, three.GetProperty("quantity").GetInt32());
        Assert.Equal(1, zero.GetProperty("quantity").GetInt32());
    }

    [Fact]
    public async Task A_participant_session_attributes_the_custom_item_to_itself()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        var personId = Guid.NewGuid().ToString("N");
        var token = ParticipantSession.Encode(householdId, personId);

        // The body names someone else; the session's own person wins.
        var item = await AddCustomAsync(
            client, householdId, "2026-W12", new { displayName = "sparklers", personId = "someone-else" }, token);

        Assert.Equal(personId, item.GetProperty("addedByPersonId").GetString());
    }

    [Fact]
    public async Task An_unauthenticated_custom_item_post_is_401()
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

        using var response = await client.PostAsJsonAsync(
            ItemsRoute(Guid.NewGuid().ToString("N"), "2026-W13"),
            new { displayName = "unicorn steaks", personId = "person-3" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task A_blank_display_name_is_a_400_problem_and_adds_nothing(string? displayName)
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W14";

        using var response = await CaptureTestHelper.PostAsync(
            client, ItemsRoute(householdId, week), new { displayName, personId = "person-4" });

        await CaptureTestHelper.AssertProblemAsync(response, HttpStatusCode.BadRequest, "Validation failed.");

        // Rejected before any write: not even the week's cart row was created.
        using var read = await client.GetAsync(
            new Uri($"/households/{householdId}/carts/{week}", UriKind.Relative));
        await CaptureTestHelper.AssertProblemAsync(read, HttpStatusCode.NotFound, "Cart not found.");
    }

    [Fact]
    public async Task A_custom_item_with_no_resolvable_actor_is_a_400()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);

        using var withBody = await CaptureTestHelper.PostAsync(
            client, ItemsRoute(householdId, "2026-W15"), new { displayName = "unicorn steaks" });
        await CaptureTestHelper.AssertProblemAsync(
            withBody, HttpStatusCode.BadRequest, "A person is required to add to the cart.");

        using var noBody = await CaptureTestHelper.PostEmptyAsync(client, ItemsRoute(householdId, "2026-W15"));
        await CaptureTestHelper.AssertProblemAsync(
            noBody, HttpStatusCode.BadRequest, "A person is required to add to the cart.");
    }

    [Fact]
    public async Task A_custom_item_for_an_unknown_household_is_a_404()
    {
        using var client = _factory.CreateClient();

        using var response = await CaptureTestHelper.PostAsync(
            client,
            ItemsRoute(Guid.NewGuid().ToString("N"), "2026-W16"),
            new { displayName = "unicorn steaks", personId = "person-5" });

        await CaptureTestHelper.AssertProblemAsync(response, HttpStatusCode.NotFound, "Household not found.");
    }

    [Fact]
    public async Task A_custom_item_for_a_malformed_week_is_a_400()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);

        using var response = await CaptureTestHelper.PostAsync(
            client, ItemsRoute(householdId, "not-a-week"), new { displayName = "unicorn steaks", personId = "person-6" });

        await CaptureTestHelper.AssertProblemAsync(response, HttpStatusCode.BadRequest, "Validation failed.");
    }

    [Fact]
    public async Task A_custom_item_on_a_confirmed_week_is_a_409()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W17";

        await CaptureTestHelper.GetCurrentCartAsync(client, householdId, week);
        await ConfirmWeekInStorageAsync(householdId, week);

        using var response = await CaptureTestHelper.PostAsync(
            client, ItemsRoute(householdId, week), new { displayName = "unicorn steaks", personId = "person-7" });

        await CaptureTestHelper.AssertProblemAsync(
            response, HttpStatusCode.Conflict, "The week's cart is already confirmed.");

        var cart = await CaptureTestHelper.GetCartAsync(client, householdId, week);
        Assert.Empty(cart.GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task The_cart_read_totals_catalog_items_and_counts_custom_ones()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W18";

        // Oat milk is $3.79 (x2) and rice $1.89 in the fixture catalog; the
        // custom line is not priced.
        await CaptureTestHelper.CaptureAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add oat milk", personId = "person-8", weekIso = week, quantity = 2 });
        await CaptureTestHelper.CaptureAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add rice", personId = "person-8", weekIso = week });
        await AddCustomAsync(client, householdId, week, new { displayName = "unicorn steaks", personId = "person-8" });

        var byWeek = await CaptureTestHelper.GetCartAsync(client, householdId, week);
        Assert.Equal(3, byWeek.GetProperty("items").GetArrayLength());
        Assert.Equal(9.47m, byWeek.GetProperty("estimatedTotal").GetDecimal());
        Assert.Equal(1, byWeek.GetProperty("customItemCount").GetInt32());

        var current = await CaptureTestHelper.GetCurrentCartAsync(client, householdId, week);
        Assert.Equal(9.47m, current.GetProperty("estimatedTotal").GetDecimal());
        Assert.Equal(1, current.GetProperty("customItemCount").GetInt32());
    }

    [Fact]
    public void Custom_item_count_counts_only_custom_lines()
    {
        var cart = new CartResponse(
            "2026-W19",
            CartStatus.Building,
            null,
            null,
            "etag",
            [
                new CartItemView("a", "heb-0017", "Oat Milk", 1, "p", "simulated-heb", "$3.79"),
                new CartItemView("b", null, "Unicorn Steaks", 1, "p", CartItemSources.Custom, null, IsCustom: true),
                new CartItemView("c", null, "Party Hats", 2, "p", CartItemSources.Custom, null, IsCustom: true),
            ]);

        Assert.Equal(2, cart.CustomItemCount);
        Assert.Equal(3.79m, cart.EstimatedTotal);
    }

    [Fact]
    public async Task Adding_a_custom_item_advances_the_carts_version()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W20";

        var review = await CaptureTestHelper.GetCurrentCartAsync(client, householdId, week);
        await AddCustomAsync(client, householdId, week, new { displayName = "unicorn steaks", personId = "person-9" });

        // The cart grew a line after the review, so confirming the reviewed version
        // is stale: the organizer must re-read first.
        using var stale = await ConfirmAsync(client, householdId, week, review.GetProperty("eTag").GetString());
        await CaptureTestHelper.AssertProblemAsync(
            stale, HttpStatusCode.PreconditionFailed, "The resource was modified by another request.");
    }

    [Fact]
    public async Task Confirming_a_cart_keeps_its_custom_items()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W21";

        await CaptureTestHelper.CaptureAsync(
            client,
            CaptureTestHelper.TextRoute(householdId),
            new { utterance = "add black beans", personId = "person-10", weekIso = week });
        var custom = await AddCustomAsync(
            client, householdId, week, new { displayName = "unicorn steaks", personId = "person-10" });

        var review = await CaptureTestHelper.GetCartAsync(client, householdId, week);
        using var response = await ConfirmAsync(client, householdId, week, review.GetProperty("eTag").GetString());
        var confirmed = await CaptureTestHelper.ReadOkAsync(response);

        // The D-8 order intent carries the custom line alongside the catalog one.
        Assert.Equal(CartStatus.Confirmed, confirmed.GetProperty("status").GetString());
        var items = confirmed.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(2, items.Length);
        var line = Assert.Single(items, i => i.GetProperty("isCustom").GetBoolean());
        Assert.Equal(custom.GetProperty("itemId").GetString(), line.GetProperty("itemId").GetString());
        Assert.Equal("unicorn steaks", line.GetProperty("displayName").GetString());
        Assert.Equal(1, confirmed.GetProperty("customItemCount").GetInt32());
        Assert.Equal(0.89m, confirmed.GetProperty("estimatedTotal").GetDecimal());

        // ... and so does a later read of the confirmed week.
        var reread = await CaptureTestHelper.GetCartAsync(client, householdId, week);
        Assert.Contains(
            reread.GetProperty("items").EnumerateArray(),
            i => i.GetProperty("isCustom").GetBoolean()
                && i.GetProperty("displayName").GetString() == "unicorn steaks");
    }
}
