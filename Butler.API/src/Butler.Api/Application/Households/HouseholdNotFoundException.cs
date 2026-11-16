namespace Butler.Api.Application.Households;

/// <summary>
/// Thrown when an organizer create or update targets a household that does not
/// exist, for example after teardown or for an id that never existed (#295). The
/// API maps it to <c>404</c> with the title <c>Household not found.</c>. Use
/// <see cref="ForHousehold"/> to name the household.
/// </summary>
public sealed class HouseholdNotFoundException : Exception
{
    private const string DefaultMessage = "The household does not exist.";

    public HouseholdNotFoundException()
        : base(DefaultMessage)
    {
    }

    public HouseholdNotFoundException(string message)
        : base(message)
    {
    }

    public HouseholdNotFoundException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    private HouseholdNotFoundException(string message, string householdId)
        : base(message)
    {
        HouseholdId = householdId;
    }

    /// <summary>The household that does not exist (empty when not supplied).</summary>
    public string HouseholdId { get; } = string.Empty;

    /// <summary>Creates the exception naming the missing household.</summary>
    /// <param name="householdId">The household that does not exist.</param>
    public static HouseholdNotFoundException ForHousehold(string householdId) =>
        new($"No household with id '{householdId}' exists.", householdId);
}
