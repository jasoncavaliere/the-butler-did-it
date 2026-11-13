namespace Butler.Api.Application.Demo;

/// <summary>A summary of one demo-household seed run.</summary>
/// <param name="HouseholdId">The stable demo household id (<see cref="DemoHousehold.Id"/>).</param>
/// <param name="HouseholdName">The demo household's display name.</param>
/// <param name="CurrentWeekIso">The clock's current ISO week, which holds the assignments.</param>
/// <param name="HistoryWeekIsos">The ISO weeks that hold the completion history, oldest first.</param>
/// <param name="RoomCount">How many rooms were created.</param>
/// <param name="ParticipantCount">How many chore-doing family members were created.</param>
/// <param name="ChoreCount">How many chores were created.</param>
/// <param name="CompletionCount">How many completions were recorded (history plus the current week).</param>
/// <param name="AssignmentCount">How many current-week assignments were generated.</param>
/// <param name="CartItemCount">How many items were added to the current week's cart.</param>
public sealed record DemoSeedResponse(
    string HouseholdId,
    string HouseholdName,
    string CurrentWeekIso,
    IReadOnlyList<string> HistoryWeekIsos,
    int RoomCount,
    int ParticipantCount,
    int ChoreCount,
    int CompletionCount,
    int AssignmentCount,
    int CartItemCount);
