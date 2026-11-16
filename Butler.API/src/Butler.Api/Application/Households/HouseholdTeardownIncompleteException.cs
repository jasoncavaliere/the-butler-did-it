namespace Butler.Api.Application.Households;

/// <summary>
/// Thrown when a household teardown fails or is cancelled after the household's
/// own row was deleted (#294). The teardown service restores that row before it
/// throws, so a retry of the same <c>DELETE</c> finds the household and finishes
/// the purge. The API maps it to <c>500</c> with the problem extensions
/// <c>reason</c> (<c>teardownIncomplete</c>) and <c>householdId</c>. Use
/// <see cref="ForHousehold"/> to carry the household and the original failure.
/// The message never includes the inner exception's message, because the API
/// copies it into the problem detail.
/// </summary>
public sealed class HouseholdTeardownIncompleteException : Exception
{
    private const string DefaultMessage = "The household was not fully torn down.";

    public HouseholdTeardownIncompleteException()
        : base(DefaultMessage)
    {
    }

    public HouseholdTeardownIncompleteException(string message)
        : base(message)
    {
    }

    public HouseholdTeardownIncompleteException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    private HouseholdTeardownIncompleteException(string message, string householdId, Exception innerException)
        : base(message, innerException)
    {
        HouseholdId = householdId;
    }

    /// <summary>The household whose teardown did not finish (empty when not supplied).</summary>
    public string HouseholdId { get; } = string.Empty;

    /// <summary>Creates the exception naming the household, wrapping the failure that stopped the teardown.</summary>
    /// <param name="householdId">The household whose teardown did not finish.</param>
    /// <param name="innerException">The failure or cancellation that stopped it.</param>
    public static HouseholdTeardownIncompleteException ForHousehold(string householdId, Exception innerException) =>
        new(
            $"Household '{householdId}' was not fully torn down; some of its data remains. Retry the DELETE to finish removing it.",
            householdId,
            innerException);
}
