using Azure.Core;
using Butler.Api.Infrastructure.Storage;
using Microsoft.Extensions.Options;
using NSubstitute;

namespace Butler.Api.Tests.Storage;

/// <summary>
/// Criterion: the <see cref="TableClientFactory"/> resolves a
/// <see cref="Azure.Data.Tables.TableClient"/> per table name from configuration -
/// a connection string locally, managed identity (an account endpoint) in
/// deployed environments - and refuses to guess when neither is configured.
/// Client construction is lazy, so these assertions make no network call.
/// </summary>
public sealed class TableClientFactoryTests
{
    [Fact]
    public void Connection_string_resolves_a_named_client_for_the_account()
    {
        var factory = new TableClientFactory(
            Options.Create(new StorageOptions { ConnectionString = "UseDevelopmentStorage=true" }));

        var client = factory.GetTableClient("Households");

        Assert.Equal("Households", client.Name);
        // Azurite's well-known development account.
        Assert.Equal("devstoreaccount1", client.AccountName);
    }

    [Fact]
    public void Account_name_resolves_the_managed_identity_endpoint()
    {
        var credential = Substitute.For<TokenCredential>();
        var factory = new TableClientFactory(
            Options.Create(new StorageOptions { AccountName = "butlerstore" }),
            credential);

        var client = factory.GetTableClient("Rooms");

        Assert.Equal("Rooms", client.Name);
        Assert.Equal("butlerstore", client.AccountName);
        Assert.Contains("butlerstore.table.core.windows.net", client.Uri.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void Explicit_service_uri_wins_over_the_derived_endpoint()
    {
        var credential = Substitute.For<TokenCredential>();
        var factory = new TableClientFactory(
            Options.Create(new StorageOptions
            {
                AccountName = "ignored",
                TableServiceUri = "https://sovereign.table.core.chinacloudapi.cn",
            }),
            credential);

        var client = factory.GetTableClient("Chores");

        Assert.Contains("chinacloudapi.cn", client.Uri.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void Throws_when_no_connection_is_configured()
    {
        var credential = Substitute.For<TokenCredential>();
        var factory = new TableClientFactory(Options.Create(new StorageOptions()), credential);

        Assert.Throws<InvalidOperationException>(() => factory.GetTableClient("Households"));
    }

    [Fact]
    public void Public_constructor_builds_a_default_credential_factory()
    {
        // Exercises the production constructor (DefaultAzureCredential). The
        // connection-string path does not touch the credential, so no auth flow runs.
        var factory = new TableClientFactory(
            Options.Create(new StorageOptions { ConnectionString = "UseDevelopmentStorage=true" }));

        Assert.Equal("People", factory.GetTableClient("People").Name);
    }
}
