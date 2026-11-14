using System.Globalization;

namespace Butler.Api.Application.Auth;

/// <summary>
/// Tuning for the local demo PIN organizer (#105), bound from the
/// <c>Authentication:Pin</c> section (<c>appsettings.Demo.json</c> sets it). The
/// PIN itself is never configured here: it is read from the
/// <see cref="PinConfigurationKey"/> environment variable so it is never committed.
/// </summary>
public sealed class PinOrganizerOptions
{
    /// <summary>Configuration section this binds from.</summary>
    public const string SectionName = "Authentication:Pin";

    /// <summary>
    /// The configuration key (an environment variable in practice) that holds the
    /// 4-6 digit demo PIN. The demo stack passes it from the git-ignored
    /// <c>demo/.env</c>.
    /// </summary>
    public const string PinConfigurationKey = "BUTLER_DEMO_PIN";

    /// <summary>Consecutive wrong PINs that start a lockout. Default 5.</summary>
    public int MaxFailedAttempts { get; set; } = 5;

    /// <summary>How long every PIN attempt is refused once locked out. Default 60 s.</summary>
    public TimeSpan LockoutDuration { get; set; } = TimeSpan.FromMinutes(1);

    /// <summary>
    /// How long an organizer token may go unused before it is rejected. Each
    /// authorized request restarts it (sliding idle expiry). Default 15 min.
    /// </summary>
    public TimeSpan IdleTimeout { get; set; } = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Throws an <see cref="InvalidOperationException"/> naming the offending key
    /// when any value is zero or negative.
    /// </summary>
    public void Validate()
    {
        if (MaxFailedAttempts <= 0)
        {
            throw Invalid(nameof(MaxFailedAttempts), MaxFailedAttempts.ToString(CultureInfo.InvariantCulture));
        }

        if (LockoutDuration <= TimeSpan.Zero)
        {
            throw Invalid(nameof(LockoutDuration), LockoutDuration.ToString("c", CultureInfo.InvariantCulture));
        }

        if (IdleTimeout <= TimeSpan.Zero)
        {
            throw Invalid(nameof(IdleTimeout), IdleTimeout.ToString("c", CultureInfo.InvariantCulture));
        }
    }

    private static InvalidOperationException Invalid(string name, string value) =>
        new($"{SectionName}:{name} must be greater than zero (was '{value}'). " +
            "Refusing to start misconfigured (fail closed).");
}
