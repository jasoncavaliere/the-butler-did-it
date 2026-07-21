namespace Butler.Api.Infrastructure.Assignments;

/// <summary>
/// The two lifecycle states an <see cref="AssignmentEntity"/> can hold
/// (Engineering Contract 7.3). Stored as a plain string on the Table row; these
/// constants keep the values off magic-string literals across the assignment and
/// completion code paths.
/// </summary>
public static class AssignmentStatus
{
    /// <summary>The chore is assigned but not yet completed.</summary>
    public const string Open = "Open";

    /// <summary>The chore has been completed for the week.</summary>
    public const string Done = "Done";
}
