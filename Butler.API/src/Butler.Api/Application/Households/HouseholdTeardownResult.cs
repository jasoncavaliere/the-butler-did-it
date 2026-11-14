namespace Butler.Api.Application.Households;

/// <summary>The outcome of a household teardown request (#124).</summary>
public enum HouseholdTeardownResult
{
    /// <summary>Every row the household owned was deleted (mapped to <c>204</c>).</summary>
    Deleted,

    /// <summary>No household has that id; nothing was deleted (mapped to <c>404</c>).</summary>
    NotFound,

    /// <summary>
    /// The confirmation name did not exactly equal the stored name; nothing was
    /// deleted (mapped to <c>400</c>).
    /// </summary>
    NameMismatch,
}
