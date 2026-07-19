using Butler.Api.Infrastructure.Storage;

namespace Butler.Api.Tests.Storage;

/// <summary>
/// Criterion: a configuration flag lets the API fall back to the in-memory store.
/// <see cref="StorageOptions.ResolveUseInMemory"/> is the decision: the explicit
/// override when set, otherwise in-memory exactly when no storage connection is
/// configured (so local runs and tests need no Azurite).
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
}
