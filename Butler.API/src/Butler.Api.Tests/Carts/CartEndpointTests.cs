using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Infrastructure.Carts;
using Butler.Api.Tests.TestSupport;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.Carts;

/// <summary>
/// Criteria (G2), end to end through the real HTTP pipeline:
/// <c>GET /households/{householdId}/carts/current</c> returns the week's
/// <c>Building</c> cart - creating it on first use and returning the same cart on
/// the next call - and <c>GET /households/{householdId}/carts/{weekIso}</c>
/// returns that week's cart plus its items in one response shape, carrying the
/// <c>ETag</c> a later mutation supplies as <c>If-Match</c>. An unknown household
/// is a <c>404</c> RFC 7807 document, as is a week with no cart; a malformed week
/// is a <c>400</c>; and a week already confirmed is a <c>409</c> rather than a
/// confirmed cart dressed up as the building one.
/// </summary>
public sealed class CartEndpointTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public CartEndpointTests(ButlerApiFactory factory) => _factory = factory;

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

    private static async Task<JsonElement> GetCartAsync(HttpClient client, Uri uri)
    {
        using var response = await client.GetAsync(uri);
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.Clone();
    }

    [Fact]
    public async Task Current_returns_a_building_cart_with_an_etag_and_no_items()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        var cart = await GetCartAsync(
            client, new Uri($"/households/{householdId}/carts/current", UriKind.Relative));

        Assert.Equal(CartStatus.Building, cart.GetProperty("status").GetString());
        Assert.False(string.IsNullOrWhiteSpace(cart.GetProperty("weekIso").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(cart.GetProperty("eTag").GetString()));
        Assert.Equal(JsonValueKind.Null, cart.GetProperty("confirmedByPersonId").ValueKind);
        Assert.Equal(JsonValueKind.Null, cart.GetProperty("confirmedUtc").ValueKind);
        Assert.Empty(cart.GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task A_second_current_read_returns_the_same_cart()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        var uri = new Uri($"/households/{householdId}/carts/current", UriKind.Relative);

        var first = await GetCartAsync(client, uri);
        var second = await GetCartAsync(client, uri);

        Assert.Equal(first.GetProperty("weekIso").GetString(), second.GetProperty("weekIso").GetString());
        // Get-or-create never mints a second row for the week, so the version
        // stamp is untouched by the second read.
        Assert.Equal(first.GetProperty("eTag").GetString(), second.GetProperty("eTag").GetString());
    }

    [Fact]
    public async Task Current_honours_a_supplied_week()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        var cart = await GetCartAsync(
            client,
            new Uri($"/households/{householdId}/carts/current?weekIso=2026-W40", UriKind.Relative));

        Assert.Equal("2026-W40", cart.GetProperty("weekIso").GetString());
    }

    [Fact]
    public async Task The_by_week_read_returns_the_cart_with_its_items_in_one_shape()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        const string week = "2026-W35";

        // Create the week's cart through the public get-or-create surface, then
        // seed an item on the same seam the capture flow (G3) will write through.
        await GetCartAsync(
            client,
            new Uri($"/households/{householdId}/carts/current?weekIso={week}", UriKind.Relative));

        var items = _factory.Services.GetRequiredService<ICartItemRepository>();
        await items.AddAsync(
            householdId,
            new CartItemEntity
            {
                RowKey = CartItemEntity.RowKeyFor(week, "item-1"),
                CartWeekIso = week,
                ItemId = "item-1",
                ProductId = "heb-oat-milk",
                DisplayName = "Oat Milk",
                Quantity = 3,
                AddedByPersonId = "person-7",
                SourceConnector = "simulated-heb",
            },
            CancellationToken.None);

        var cart = await GetCartAsync(
            client, new Uri($"/households/{householdId}/carts/{week}", UriKind.Relative));

        Assert.Equal(week, cart.GetProperty("weekIso").GetString());
        Assert.Equal(CartStatus.Building, cart.GetProperty("status").GetString());
        var item = Assert.Single(cart.GetProperty("items").EnumerateArray().ToArray());
        Assert.Equal("item-1", item.GetProperty("itemId").GetString());
        Assert.Equal("heb-oat-milk", item.GetProperty("productId").GetString());
        Assert.Equal("Oat Milk", item.GetProperty("displayName").GetString());
        Assert.Equal(3, item.GetProperty("quantity").GetInt32());
        Assert.Equal("person-7", item.GetProperty("addedByPersonId").GetString());
        Assert.Equal("simulated-heb", item.GetProperty("sourceConnector").GetString());
    }

    [Fact]
    public async Task An_unknown_household_is_404_problem_details_on_both_routes()
    {
        using var client = _factory.CreateClient();
        var unknown = Guid.NewGuid().ToString("N");

        using var current = await client.GetAsync(
            new Uri($"/households/{unknown}/carts/current", UriKind.Relative));
        await AssertProblemAsync(current, HttpStatusCode.NotFound, "Household not found.");

        using var byWeek = await client.GetAsync(
            new Uri($"/households/{unknown}/carts/2026-W29", UriKind.Relative));
        await AssertProblemAsync(byWeek, HttpStatusCode.NotFound, "Household not found.");
    }

    [Fact]
    public async Task A_week_with_no_cart_is_404_problem_details()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var response = await client.GetAsync(
            new Uri($"/households/{householdId}/carts/2026-W02", UriKind.Relative));

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "Cart not found.");
    }

    [Fact]
    public async Task A_malformed_week_is_a_400_on_both_routes()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);

        using var current = await client.GetAsync(
            new Uri($"/households/{householdId}/carts/current?weekIso=not-a-week", UriKind.Relative));
        await AssertProblemAsync(current, HttpStatusCode.BadRequest, "Validation failed.");

        using var byWeek = await client.GetAsync(
            new Uri($"/households/{householdId}/carts/2026-W99", UriKind.Relative));
        await AssertProblemAsync(byWeek, HttpStatusCode.BadRequest, "Validation failed.");
    }

    [Fact]
    public async Task A_confirmed_week_is_a_409_rather_than_the_building_cart()
    {
        using var client = _factory.CreateClient();
        var householdId = await CreateHouseholdAsync(client);
        const string week = "2026-W36";
        var currentUri = new Uri(
            $"/households/{householdId}/carts/current?weekIso={week}", UriKind.Relative);

        await GetCartAsync(client, currentUri);

        // Flip the week's single row to Confirmed on the same seam G4 will use.
        var carts = _factory.Services.GetRequiredService<ICartRepository>();
        var stored = await carts.GetAsync(householdId, week, CancellationToken.None);
        stored!.Status = CartStatus.Confirmed;
        stored.ConfirmedByPersonId = "organizer-1";
        stored.ConfirmedUtc = new DateTimeOffset(2026, 9, 3, 12, 0, 0, TimeSpan.Zero);
        await carts.UpdateAsync(householdId, stored, stored.ETag.ToString(), CancellationToken.None);

        using var conflict = await client.GetAsync(currentUri);
        await AssertProblemAsync(conflict, HttpStatusCode.Conflict, "The week's cart is already confirmed.");

        // The confirmed cart is still readable through the by-week route.
        var read = await GetCartAsync(
            client, new Uri($"/households/{householdId}/carts/{week}", UriKind.Relative));
        Assert.Equal(CartStatus.Confirmed, read.GetProperty("status").GetString());
        Assert.Equal("organizer-1", read.GetProperty("confirmedByPersonId").GetString());
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
