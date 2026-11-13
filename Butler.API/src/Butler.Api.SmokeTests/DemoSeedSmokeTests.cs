using System.Net;
using System.Text.Json;
using Azure.Data.Tables;

namespace Butler.Api.SmokeTests;

/// <summary>
/// Criterion (#97 AC5): seeding the demo household twice against a running API
/// on real Table Storage (Azurite) replaces it cleanly - no duplicate rows, no
/// 409 from a row key that already exists. Needs the API in Development (or
/// Demo) at <see cref="SmokeSettings.BaseUrl"/>, where the dev organizer bypass
/// satisfies the organizer policy. Mutating: never point it at a deployed
/// environment.
/// </summary>
/// <remarks>
/// The API never creates its tables, and a fresh Azurite has none, so the test
/// creates the tables the seeder touches first (a no-op when they exist). It
/// uses <see cref="SmokeSettings.StorageConnectionString"/>, which must point at
/// the same Azurite the API uses.
/// </remarks>
[Trait(SmokeCategories.Name, SmokeCategories.Demo)]
public sealed class DemoSeedSmokeTests : IAsyncLifetime
{
    private const string DemoHouseholdId = "demo-household";

    private static readonly string[] Tables =
    [
        "Households", "People", "Rooms", "Chores", "Assignments",
        "ChoreCompletions", "Carts", "CartItems", "HubDevices",
    ];

    public async Task InitializeAsync()
    {
        var service = new TableServiceClient(SmokeSettings.Current.StorageConnectionString);
        foreach (var table in Tables)
        {
            await service.CreateTableIfNotExistsAsync(table);
        }
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Post_demo_seed_twice_is_idempotent_against_table_storage()
    {
        using var client = SmokeSettings.Current.CreateHttpClient();

        for (var run = 0; run < 2; run++)
        {
            using var seed = await client.PostAsync(new Uri("demo/seed", UriKind.Relative), content: null);
            Assert.Equal(HttpStatusCode.OK, seed.StatusCode);

            using var seeded = JsonDocument.Parse(await seed.Content.ReadAsStringAsync());
            Assert.Equal(DemoHouseholdId, seeded.RootElement.GetProperty("householdId").GetString());
        }

        using var people = await client.GetAsync(
            new Uri($"households/{DemoHouseholdId}/people", UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, people.StatusCode);
        using var roster = JsonDocument.Parse(await people.Content.ReadAsStringAsync());
        Assert.Equal(4, roster.RootElement.GetArrayLength());

        using var fairness = await client.GetAsync(
            new Uri($"households/{DemoHouseholdId}/fairness", UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, fairness.StatusCode);
        using var balance = JsonDocument.Parse(await fairness.Content.ReadAsStringAsync());
        Assert.Equal(
            JsonValueKind.String,
            balance.RootElement.GetProperty("topContributorPersonId").ValueKind);
    }
}
