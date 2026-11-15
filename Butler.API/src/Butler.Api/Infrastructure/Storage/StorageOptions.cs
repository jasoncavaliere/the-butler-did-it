namespace Butler.Api.Infrastructure.Storage;

/// <summary>
/// Configuration for the Table Storage seam, bound from the <c>Storage</c>
/// section. Two ways to reach real storage: a <see cref="ConnectionString"/>
/// (local/Azurite) or an account reached with managed identity in deployed
/// environments (<see cref="AccountName"/> or an explicit
/// <see cref="TableServiceUri"/>). When none of those is set - and unless
/// <see cref="UseInMemoryStore"/> forces the choice either way - the API falls
/// back to the in-memory seed store so local runs and tests need no Azurite
/// (Engineering Contract 7.3). <see cref="ProvisioningTimeout"/> bounds how long
/// startup waits to create the tables (#174), capped at
/// <see cref="MaxProvisioningTimeout"/> (#256).
/// </summary>
public sealed class StorageOptions
{
    /// <summary>Configuration section this binds from.</summary>
    public const string SectionName = "Storage";

    /// <summary>
    /// The upper bound on creating every table at startup when
    /// <see cref="ProvisioningTimeout"/> is unset or not positive: 30 seconds,
    /// long enough for a lazy managed-identity token and well under App
    /// Service's 230-second startup limit.
    /// </summary>
    public static readonly TimeSpan DefaultProvisioningTimeout = TimeSpan.FromSeconds(30);

    /// <summary>
    /// The ceiling on <see cref="ProvisioningTimeout"/>: 3 minutes, still under
    /// App Service's 230-second startup limit. A larger value is clamped to this
    /// (#256), because configuration binds a bare number such as <c>30</c> as
    /// that many days, which would otherwise disable the bound.
    /// </summary>
    public static readonly TimeSpan MaxProvisioningTimeout = TimeSpan.FromMinutes(3);

    /// <summary>
    /// Table Storage connection string. Locally this is Azurite's
    /// <c>UseDevelopmentStorage=true</c>; unset in deployed environments, which
    /// use managed identity instead.
    /// </summary>
    public string? ConnectionString { get; set; }

    /// <summary>
    /// Storage account name for the managed-identity path. The table service URI
    /// is derived as <c>https://&lt;account&gt;.table.core.windows.net</c> when
    /// <see cref="TableServiceUri"/> is not given explicitly.
    /// </summary>
    public string? AccountName { get; set; }

    /// <summary>
    /// Explicit table service endpoint for the managed-identity path (overrides
    /// the value derived from <see cref="AccountName"/>). Useful for sovereign
    /// clouds or custom endpoints.
    /// </summary>
    public string? TableServiceUri { get; set; }

    /// <summary>
    /// Explicit override for the in-memory fallback. <c>true</c> forces the
    /// in-memory store even when a connection is configured; <c>false</c> forces
    /// real storage; <c>null</c> (the default) decides automatically - see
    /// <see cref="ResolveUseInMemory"/>.
    /// </summary>
    public bool? UseInMemoryStore { get; set; }

    /// <summary>
    /// Whether the API should use the in-memory seed store: the explicit
    /// <see cref="UseInMemoryStore"/> when set, otherwise <c>true</c> exactly
    /// when no storage connection is configured at all.
    /// </summary>
    public bool ResolveUseInMemory() =>
        UseInMemoryStore ?? !IsStorageConfigured();

    /// <summary>
    /// Upper bound on creating all registered tables at startup (configuration
    /// key <c>Storage:ProvisioningTimeout</c>, a TimeSpan such as
    /// <c>00:00:30</c>). When it expires, the table in flight is logged and
    /// startup fails. <c>null</c> or a non-positive value means
    /// <see cref="DefaultProvisioningTimeout"/>; a value above
    /// <see cref="MaxProvisioningTimeout"/> is clamped to it. Use hh:mm:ss: a
    /// bare number such as <c>30</c> binds as days - see
    /// <see cref="ResolveProvisioningTimeout"/>.
    /// </summary>
    public TimeSpan? ProvisioningTimeout { get; set; }

    /// <summary>
    /// The effective provisioning bound: <see cref="MaxProvisioningTimeout"/>
    /// when <see cref="IsProvisioningTimeoutClamped"/>, otherwise
    /// <see cref="ProvisioningTimeout"/> when it is set and positive, otherwise
    /// <see cref="DefaultProvisioningTimeout"/>.
    /// </summary>
    public TimeSpan ResolveProvisioningTimeout()
    {
        if (IsProvisioningTimeoutClamped())
        {
            return MaxProvisioningTimeout;
        }

        return ProvisioningTimeout is { } timeout && timeout > TimeSpan.Zero ? timeout : DefaultProvisioningTimeout;
    }

    /// <summary>
    /// Whether the configured <see cref="ProvisioningTimeout"/> exceeds
    /// <see cref="MaxProvisioningTimeout"/> and so resolves to the ceiling
    /// (#256). A value exactly at the ceiling is not clamped.
    /// </summary>
    public bool IsProvisioningTimeoutClamped() =>
        ProvisioningTimeout is { } timeout && timeout > MaxProvisioningTimeout;

    /// <summary>Whether any real-storage connection detail is configured.</summary>
    public bool IsStorageConfigured() =>
        !string.IsNullOrWhiteSpace(ConnectionString)
        || !string.IsNullOrWhiteSpace(AccountName)
        || !string.IsNullOrWhiteSpace(TableServiceUri);
}
