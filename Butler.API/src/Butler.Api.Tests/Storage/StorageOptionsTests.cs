using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Tests.Storage;

/// <summary>
/// Criterion: a configuration flag lets the API fall back to the in-memory store.
/// <see cref="StorageOptions.ResolveUseInMemory"/> is the decision: the explicit
/// override when set, otherwise in-memory exactly when no storage connection is
/// configured (so local runs and tests need no Azurite). #174:
/// <see cref="StorageOptions.ResolveProvisioningTimeout"/> applies the 30-second
/// default when the bound is unset or not positive.
/// </summary>
public sealed class StorageOptionsTests
{
    [Fact]
    public void Falls_back_to_in_memory_when_nothing_is_configured()
    {
        var options = new StorageOptions();

        Assert.False(options.IsStorageConfigured());
        Assert.True(options.ResolveUseInMemory());
    }

    [Theory]
    [InlineData("UseDevelopmentStorage=true", null, null)]
    [InlineData(null, "butlerstore", null)]
    [InlineData(null, null, "https://butlerstore.table.core.windows.net")]
    public void Uses_real_storage_when_a_connection_is_configured(
        string? connectionString,
        string? accountName,
        string? tableServiceUri)
    {
        var options = new StorageOptions
        {
            ConnectionString = connectionString,
            AccountName = accountName,
            TableServiceUri = tableServiceUri,
        };

        Assert.True(options.IsStorageConfigured());
        Assert.False(options.ResolveUseInMemory());
    }

    [Fact]
    public void Explicit_flag_overrides_a_configured_connection()
    {
        var options = new StorageOptions
        {
            ConnectionString = "UseDevelopmentStorage=true",
            UseInMemoryStore = true,
        };

        Assert.True(options.ResolveUseInMemory());
    }

    [Fact]
    public void Explicit_flag_can_force_real_storage_off_the_default()
    {
        // No connection configured, but the operator has explicitly opted out of
        // the in-memory store (so the factory path is taken).
        var options = new StorageOptions { UseInMemoryStore = false };

        Assert.False(options.ResolveUseInMemory());
    }

    [Fact]
    public void ProvisioningTimeout_defaults_to_30_seconds_when_unset()
    {
        var options = new StorageOptions();

        Assert.Null(options.ProvisioningTimeout);
        Assert.Equal(TimeSpan.FromSeconds(30), StorageOptions.DefaultProvisioningTimeout);
        Assert.Equal(StorageOptions.DefaultProvisioningTimeout, options.ResolveProvisioningTimeout());
    }

    [Fact]
    public void ProvisioningTimeout_uses_the_configured_value()
    {
        var options = new StorageOptions { ProvisioningTimeout = TimeSpan.FromSeconds(5) };

        Assert.Equal(TimeSpan.FromSeconds(5), options.ResolveProvisioningTimeout());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Non_positive_ProvisioningTimeout_falls_back_to_the_default(int seconds)
    {
        var options = new StorageOptions { ProvisioningTimeout = TimeSpan.FromSeconds(seconds) };

        Assert.Equal(StorageOptions.DefaultProvisioningTimeout, options.ResolveProvisioningTimeout());
    }
}
