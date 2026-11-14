namespace Butler.Api.Application.Demo;

/// <summary>
/// The static script for the demo household (#97): a believable family with
/// rooms, two adults, two children, fifteen chores, three weeks of completion
/// history that gets fairer week over week, and a small grocery cart. Everything
/// here is data; <see cref="DemoSeeder"/> turns it into rows through the
/// application services. Dates are never stored here - the seeder derives every
/// one of them from the injected clock.
/// </summary>
public static class DemoHousehold
{
    /// <summary>The stable id the demo household is always created under.</summary>
    public const string Id = "demo-household";

    /// <summary>The demo household's display name.</summary>
    public const string Name = "The Parker Household";

    /// <summary>The household's rooms, in display order.</summary>
    public static IReadOnlyList<DemoRoom> Rooms { get; } =
    [
        new("Kitchen", 0),
        new("Living Room", 1),
        new("Bathroom", 2),
        new("Bedrooms", 3),
        new("Laundry", 4),
        new("Yard", 5),
    ];

    /// <summary>
    /// The chore-doing family members. All four are participants: an organizer
    /// is never assigned chores and never counts in fairness, so the household's
    /// organizer is a separate, hidden roster row created with the household.
    /// Each claim colour is a design-token claim colour's dark variant
    /// (<c>claim_colors.*.dark</c> in <c>Butler.UI/design-tokens.json</c>), the
    /// form the dark-only hub stores (#120): berry, grass, blue and marigold.
    /// </summary>
    public static IReadOnlyList<DemoPerson> People { get; } =
    [
        new("maria", "Maria", IsChild: false, "#EC77B4"),
        new("dan", "Dan", IsChild: false, "#83C24E"),
        new("ava", "Ava", IsChild: true, "#77A8FF"),
        new("leo", "Leo", IsChild: true, "#E3B23C"),
    ];

    /// <summary>The household's chores, numbered 1..15 for the history script.</summary>
    public static IReadOnlyList<DemoChore> Chores { get; } =
    [
        new(1, "Load the dishwasher", "Kitchen", "Daily", 2, null),
        new(2, "Unload the dishwasher", "Kitchen", "Daily", 1, null),
        new(3, "Wipe kitchen counters", "Kitchen", "Daily", 1, null),
        new(4, "Take out trash and recycling", "Kitchen", "Weekly", 2, null),
        new(5, "Clean the fridge", "Kitchen", "Weekly", 3, 12),
        new(6, "Vacuum the living room", "Living Room", "Weekly", 3, null),
        new(7, "Dust the shelves", "Living Room", "Weekly", 1, null),
        new(8, "Tidy toys and books", "Living Room", "Daily", 1, null),
        new(9, "Scrub sink and toilet", "Bathroom", "Weekly", 3, 12),
        new(10, "Clean the shower", "Bathroom", "Weekly", 4, 14),
        new(11, "Make the beds", "Bedrooms", "Daily", 1, null),
        new(12, "Change bed sheets", "Bedrooms", "Weekly", 3, null),
        new(13, "Wash and dry laundry", "Laundry", "Weekly", 4, 14),
        new(14, "Fold and put away laundry", "Laundry", "Weekly", 2, null),
        new(15, "Mow the lawn", "Yard", "Weekly", 5, 16),
    ];

    /// <summary>
    /// Who completed which chore in each of the three weeks before the current
    /// one, oldest first. Maria carries most of the load three weeks ago and the
    /// family evens out from there, so the top contributor's share falls week over
    /// week (66.7% -> 52.8% -> 38.9%). Children only ever get chores with no
    /// minimum age.
    /// </summary>
    public static IReadOnlyList<DemoHistoryWeek> History { get; } =
    [
        new(3,
        [
            (1, "maria"), (4, "maria"), (5, "maria"), (6, "maria"), (9, "maria"), (10, "maria"), (12, "maria"), (13, "maria"),
            (14, "dan"), (15, "dan"),
            (2, "ava"), (7, "ava"), (11, "ava"),
            (3, "leo"), (8, "leo"),
        ]),
        new(2,
        [
            (1, "maria"), (5, "maria"), (9, "maria"), (10, "maria"), (12, "maria"), (13, "maria"),
            (4, "dan"), (6, "dan"), (15, "dan"),
            (2, "ava"), (7, "ava"), (14, "ava"),
            (3, "leo"), (8, "leo"), (11, "leo"),
        ]),
        new(1,
        [
            (5, "maria"), (10, "maria"), (12, "maria"), (13, "maria"),
            (4, "dan"), (6, "dan"), (9, "dan"), (15, "dan"),
            (1, "ava"), (2, "ava"), (7, "ava"), (14, "ava"),
            (3, "leo"), (8, "leo"), (11, "leo"),
        ]),
    ];

    /// <summary>
    /// The chores already completed in the current week, by whoever the
    /// assignment engine gave them to.
    /// </summary>
    public static IReadOnlyList<int> CurrentWeekCompletedChores { get; } = [2, 3, 11];

    /// <summary>
    /// The current week's cart, as exact catalog display names (catalog ids
    /// heb-0001, heb-0005, heb-0011, heb-0012) so each one resolves to a single
    /// product.
    /// </summary>
    public static IReadOnlyList<DemoCartItem> CartItems { get; } =
    [
        new("H-E-B Whole Milk", "ava"),
        new("Fresh Bananas", "leo"),
        new("H-E-B Spaghetti Pasta", "dan"),
        new("H-E-B Marinara Pasta Sauce", "maria"),
    ];
}

/// <summary>A demo room.</summary>
/// <param name="Name">The room's display name.</param>
/// <param name="SortOrder">The room's display order.</param>
public sealed record DemoRoom(string Name, int SortOrder);

/// <summary>A demo family member.</summary>
/// <param name="Key">The script key the history and cart refer to.</param>
/// <param name="DisplayName">The roster display name.</param>
/// <param name="IsChild">Whether the person is a child (limits the chores they can get).</param>
/// <param name="ClaimColor">The tile colour on the hub.</param>
public sealed record DemoPerson(string Key, string DisplayName, bool IsChild, string ClaimColor);

/// <summary>A demo chore.</summary>
/// <param name="Number">The chore's number in the history script (1-based).</param>
/// <param name="Title">The chore title.</param>
/// <param name="RoomName">The name of the <see cref="DemoRoom"/> it belongs to.</param>
/// <param name="Cadence"><c>Daily</c> or <c>Weekly</c>.</param>
/// <param name="Effort">The chore's effort weight.</param>
/// <param name="MinAge">The minimum age, or <c>null</c> when a child may do it.</param>
public sealed record DemoChore(int Number, string Title, string RoomName, string Cadence, int Effort, int? MinAge);

/// <summary>One week of scripted completion history.</summary>
/// <param name="WeeksAgo">How many weeks before the current one (1..3).</param>
/// <param name="Completions">Each completed chore number and the key of the person who did it.</param>
public sealed record DemoHistoryWeek(int WeeksAgo, IReadOnlyList<(int ChoreNumber, string PersonKey)> Completions);

/// <summary>One demo cart line.</summary>
/// <param name="DisplayName">The exact catalog display name to capture.</param>
/// <param name="AddedByKey">The key of the person who adds it.</param>
public sealed record DemoCartItem(string DisplayName, string AddedByKey);
