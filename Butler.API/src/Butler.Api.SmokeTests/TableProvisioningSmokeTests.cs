using Azure;
using Azure.Data.Tables;

namespace Butler.Api.SmokeTests;

/// <summary>
/// Criteria (#91 AC3, AC7): a running API booted against a fresh, empty
/// Azurite has created every feature table at startup, and each accepts a
/// first write with no manual setup. The test never creates a table itself, so
/// a table the API did not provision fails it. Mutating: each write lands in a
/// unique <c>smoke-provisioning-{guid}</c> partition and is deleted afterwards,
/// so never point it at a deployed environment.
/// </summary>
/// <remarks>
/// Nothing else in the smoke suite may create a feature table, or this check
/// would pass against an API that provisions nothing. The restart check in
/// <see cref="TableReprovisioningSmokeTests"/> only provisions once every table
/// already exists, so it can never mask a missing one.
/// </remarks>
[Trait(SmokeCategories.Name, SmokeCategories.Provisioning)]
public sealed class TableProvisioningSmokeTests
{
    /// <summary>Every distinct table the API registers via <c>AddTableRepository</c>.</summary>
    internal static readonly string[] Tables =
    [
        "Households", "People", "Rooms", "Chores", "ChoreCompletions",
        "Assignments", "Carts", "CartItems", "HubDevices", "Datasets", "Events",
    ];

    /// <summary><see cref="Tables"/> as theory data.</summary>
    public static TheoryData<string> FeatureTables { get; } = new(Tables);

    [Theory]
    [MemberData(nameof(FeatureTables))]
    public async Task Feature_table_exists_after_startup_and_accepts_a_first_write(string table)
    {
        var service = new TableServiceClient(SmokeSettings.Current.StorageConnectionString);

        Assert.True(
            await TableExistsAsync(service, table),
            $"The API did not create the {table} table at startup.");

        var client = service.GetTableClient(table);
        var partition = "smoke-provisioning-" + Guid.NewGuid().ToString("N");
        var entity = new TableEntity(partition, "first-write") { ["Payload"] = "provisioned" };
        try
        {
            using var response = await client.UpsertEntityAsync(entity, TableUpdateMode.Replace);
            Assert.False(response.IsError, $"The first write to {table} failed with {response.Status}.");
        }
        finally
        {
            try
            {
                await client.DeleteEntityAsync(partition, "first-write", ETag.All);
            }
            catch (RequestFailedException)
            {
                // Nothing to clean up when the write itself failed.
            }
        }
    }

    /// <summary>Whether <paramref name="table"/> exists, without ever creating it.</summary>
    internal static async Task<bool> TableExistsAsync(TableServiceClient service, string table)
    {
        await foreach (var item in service.QueryAsync(TableServiceClient.CreateQueryFilter($"TableName eq {table}")))
        {
            if (string.Equals(item.Name, table, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }
}
