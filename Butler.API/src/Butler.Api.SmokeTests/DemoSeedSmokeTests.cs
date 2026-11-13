using System.Net;
using System.Text.Json;

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
/// The API creates its registered tables at startup (#91), so the test does
/// not create any itself: a missing table fails the seed rather than being
/// masked.
/// </remarks>
[Trait(SmokeCategories.Name, SmokeCategories.Demo)]
public sealed class DemoSeedSmokeTests
{
    private const string DemoHouseholdId = "demo-household";

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
