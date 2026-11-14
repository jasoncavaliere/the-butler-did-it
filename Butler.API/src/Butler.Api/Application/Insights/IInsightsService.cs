namespace Butler.Api.Application.Insights;

/// <summary>
/// Computes the organizer's insights (#123): a read-only aggregate of the
/// household's <c>ChoreCompletions</c>, <c>Events</c> and <c>Carts</c>
/// partitions over a trailing ISO-week window. It reads only partitions keyed by
/// <c>PartitionKey = householdId</c> (Engineering Contract 7.3) and writes
/// nothing. Time arrives through the injected <see cref="TimeProvider"/> seam so
/// the window stays deterministically testable (7.5).
/// </summary>
public interface IInsightsService
{
    /// <summary>
    /// Aggregates the household's insights over the trailing
    /// <paramref name="weeks"/> ISO weeks (the current week from the injected clock
    /// and the weeks before it).
    /// </summary>
    /// <param name="householdId">The household whose insights to compute.</param>
    /// <param name="weeks">The number of trailing ISO weeks, from 1 to <see cref="InsightsService.MaxWeeks"/>.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>
    /// The insights, or <c>null</c> when no household with
    /// <paramref name="householdId"/> exists (the controller maps that to a <c>404</c>).
    /// </returns>
    /// <exception cref="System.ComponentModel.DataAnnotations.ValidationException">
    /// <paramref name="weeks"/> is missing, less than 1, or greater than
    /// <see cref="InsightsService.MaxWeeks"/> (a <c>400</c> problem).
    /// </exception>
    Task<InsightsResponse?> GetAsync(
        string householdId,
        int? weeks,
        CancellationToken cancellationToken = default);
}
