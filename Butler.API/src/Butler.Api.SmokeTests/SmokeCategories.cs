namespace Butler.Api.SmokeTests;

/// <summary>
/// Values for <c>[Trait("Category", ...)]</c> so a run can be narrowed with
/// <c>dotnet test --filter Category=...</c>. Only <see cref="Liveness"/> is
/// read-only and therefore safe against a deployed environment.
/// </summary>
internal static class SmokeCategories
{
    /// <summary>Trait name used by every smoke test.</summary>
    public const string Name = "Category";

    /// <summary>Read-only HTTP probes against <c>BUTLER_SMOKE_BASE_URL</c>; safe anywhere.</summary>
    public const string Liveness = "Liveness";

    /// <summary>Mutating round trips through the storage seam; Azurite only.</summary>
    public const string Storage = "Storage";

    /// <summary>
    /// Seeds the demo household through a running API in Development (the dev
    /// organizer bypass; Demo signs in with a PIN, #105) backed by Azurite;
    /// mutating, so never point it at a deployed environment.
    /// </summary>
    public const string Demo = "Demo";

    /// <summary>
    /// Checks that a running API created its registered tables at startup and
    /// that each accepts a first write; mutating, so Azurite only.
    /// </summary>
    public const string Provisioning = "Provisioning";

    /// <summary>
    /// Mutating round trips through the API's HTTP endpoints (a running API in
    /// Development booted against Azurite); never point it at a deployed environment.
    /// </summary>
    public const string Endpoints = "Endpoints";

    /// <summary>Offline checks of how the suite resolves its own settings.</summary>
    public const string Settings = "Settings";
}
