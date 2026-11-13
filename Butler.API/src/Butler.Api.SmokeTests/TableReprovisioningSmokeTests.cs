using Azure.Data.Tables;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.SmokeTests;

/// <summary>
/// Criterion (#91 AC6): when the API restarts against storage where its tables
/// already exist, provisioning them again succeeds. The restart is simulated
/// in-process: <c>AddStorage</c> plus <c>AddTableRepository</c> for every
/// feature table against Azurite, then <see cref="TableProvisioner.ProvisionAsync"/>.
/// </summary>
/// <remarks>
/// xUnit runs test classes in parallel, so this test must never create a
/// feature table: that would mask a table the booted API failed to provision
/// and let <see cref="TableProvisioningSmokeTests"/> pass against an API that
/// provisions nothing (#91 AC7). It therefore first requires that every table
/// already exists - created by the booted API - and only then provisions, so
/// every <c>CreateIfNotExists</c> it issues hits an existing table.
/// </remarks>
[Trait(SmokeCategories.Name, SmokeCategories.Provisioning)]
public sealed class TableReprovisioningSmokeTests
{
    [Fact]
    public async Task Provisioning_again_against_existing_tables_succeeds()
    {
        var tables = TableProvisioningSmokeTests.Tables;
        var service = new TableServiceClient(SmokeSettings.Current.StorageConnectionString);
        var missing = new List<string>();
        foreach (var table in tables)
        {
            if (!await TableProvisioningSmokeTests.TableExistsAsync(service, table))
            {
                missing.Add(table);
            }
        }

        // Fail before provisioning anything: creating a missing table here
        // would hide the startup defect the AC3/AC7 check exists to catch.
        Assert.True(
            missing.Count == 0,
            $"The booted API did not create these tables at startup: {string.Join(", ", missing)}.");

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Storage:ConnectionString"] = SmokeSettings.Current.StorageConnectionString,
                ["Storage:UseInMemoryStore"] = "false",
            })
            .Build();

        var services = new ServiceCollection()
            .AddLogging()
            .AddStorage(configuration);
        foreach (var table in tables)
        {
            services.AddTableRepository<TableEntity>(table);
        }

        await using var provider = services.BuildServiceProvider();
        var provisioner = provider.GetRequiredService<TableProvisioner>();

        Assert.Equal(tables, provisioner.TableNames);
        var exception = await Record.ExceptionAsync(() => provisioner.ProvisionAsync());
        Assert.Null(exception);
    }
}
