using System.Globalization;
using Butler.Api.Application.Auth;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Auth;

/// <summary>
/// Unit tests for the demo PIN session store (#105): the failed-attempt lockout,
/// the sliding idle expiry, sign-out, and token issuance, all against the
/// injected clock.
/// </summary>
public sealed class PinOrganizerSessionsTests
{
    private const string Pin = "4321";
    private static readonly DateTimeOffset Start = new(2026, 11, 14, 9, 0, 0, TimeSpan.Zero);

    private static (PinOrganizerSessions Sessions, MutableClock Clock) Create(PinOrganizerOptions? options = null)
    {
        var clock = new MutableClock(Start);
        return (new PinOrganizerSessions(Pin, options ?? new PinOrganizerOptions(), clock), clock);
    }

    [Fact]
    public void Correct_pin_issues_a_distinct_random_token_each_time()
    {
        var (sessions, _) = Create();

        var first = sessions.SignIn(Pin);
        var second = sessions.SignIn(Pin);

        Assert.Equal(PinSignInOutcome.SignedIn, first.Outcome);
        Assert.Equal(TimeSpan.FromMinutes(15), first.IdleTimeout);
        Assert.False(string.IsNullOrWhiteSpace(first.Token));
        Assert.NotEqual(first.Token, second.Token);
        Assert.True(sessions.TryTouch(first.Token!));
        Assert.True(sessions.TryTouch(second.Token!));
    }

    [Theory]
    [InlineData("1234")]
    [InlineData("43210")]
    [InlineData("")]
    public void Wrong_pin_is_invalid_and_issues_no_token(string pin)
    {
        var (sessions, _) = Create();

        var result = sessions.SignIn(pin);

        Assert.Equal(PinSignInOutcome.InvalidPin, result.Outcome);
        Assert.Null(result.Token);
    }

    [Fact]
    public void Lockout_refuses_the_correct_pin_until_it_ends_then_resets()
    {
        var (sessions, clock) = Create();
        for (var i = 0; i < 5; i++)
        {
            Assert.Equal(PinSignInOutcome.InvalidPin, sessions.SignIn("0000").Outcome);
        }

        var locked = sessions.SignIn(Pin);
        Assert.Equal(PinSignInOutcome.LockedOut, locked.Outcome);
        Assert.Equal(TimeSpan.FromSeconds(60), locked.RetryAfter);

        // A refused attempt neither checks the PIN nor extends the lockout.
        clock.Set(Start.AddSeconds(30));
        Assert.Equal(TimeSpan.FromSeconds(30), sessions.SignIn("0000").RetryAfter);

        clock.Set(Start.AddSeconds(60));
        Assert.Equal(PinSignInOutcome.SignedIn, sessions.SignIn(Pin).Outcome);
    }

    [Fact]
    public void The_failure_count_restarts_after_a_lockout_and_after_a_success()
    {
        var (sessions, clock) = Create(new PinOrganizerOptions { MaxFailedAttempts = 2 });

        sessions.SignIn("0000");
        Assert.Equal(PinSignInOutcome.SignedIn, sessions.SignIn(Pin).Outcome);
        Assert.Equal(PinSignInOutcome.InvalidPin, sessions.SignIn("0000").Outcome);
        Assert.Equal(PinSignInOutcome.InvalidPin, sessions.SignIn("0000").Outcome);
        Assert.Equal(PinSignInOutcome.LockedOut, sessions.SignIn(Pin).Outcome);

        clock.Set(Start.AddMinutes(1));
        Assert.Equal(PinSignInOutcome.InvalidPin, sessions.SignIn("0000").Outcome);
        Assert.Equal(PinSignInOutcome.SignedIn, sessions.SignIn(Pin).Outcome);
    }

    [Fact]
    public void Idle_expiry_slides_with_each_use_and_removes_an_expired_token()
    {
        var (sessions, clock) = Create();
        var token = sessions.SignIn(Pin).Token!;

        clock.Set(Start.AddMinutes(14).AddSeconds(59));
        Assert.True(sessions.TryTouch(token));

        clock.Set(Start.AddMinutes(29).AddSeconds(58));
        Assert.True(sessions.TryTouch(token));

        clock.Set(Start.AddMinutes(44).AddSeconds(58));
        Assert.False(sessions.TryTouch(token));

        // Removed, so it stays rejected even if the clock went backwards.
        clock.Set(Start);
        Assert.False(sessions.TryTouch(token));
    }

    [Fact]
    public void Signing_in_prunes_idle_tokens()
    {
        var (sessions, clock) = Create();
        var stale = sessions.SignIn(Pin).Token!;

        clock.Set(Start.AddMinutes(15));
        var fresh = sessions.SignIn(Pin).Token!;

        // Back inside the stale token's window: it is gone because sign-in pruned it.
        clock.Set(Start.AddMinutes(1));
        Assert.False(sessions.TryTouch(stale));
        Assert.True(sessions.TryTouch(fresh));
    }

    [Fact]
    public void Sign_out_revokes_the_token_and_ignores_unknown_tokens()
    {
        var (sessions, _) = Create();
        var token = sessions.SignIn(Pin).Token!;

        sessions.SignOut(token);
        sessions.SignOut(token);
        sessions.SignOut("unknown");

        Assert.False(sessions.TryTouch(token));
        Assert.False(sessions.TryTouch("unknown"));
    }

    [Fact]
    public void Constructor_rejects_missing_arguments()
    {
        var clock = new MutableClock(Start);
        var options = new PinOrganizerOptions();

        Assert.Throws<ArgumentException>(() => new PinOrganizerSessions(string.Empty, options, clock));
        Assert.Throws<ArgumentNullException>(() => new PinOrganizerSessions(Pin, null!, clock));
        Assert.Throws<ArgumentNullException>(() => new PinOrganizerSessions(Pin, options, null!));
    }

    [Fact]
    public void Methods_reject_null_input()
    {
        var (sessions, _) = Create();

        Assert.Throws<ArgumentNullException>(() => sessions.SignIn(null!));
        Assert.Throws<ArgumentNullException>(() => sessions.TryTouch(null!));
        Assert.Throws<ArgumentNullException>(() => sessions.SignOut(null!));
    }

    [Theory]
    [InlineData(0, "00:01:00", "00:15:00", "MaxFailedAttempts")]
    [InlineData(5, "00:00:00", "00:15:00", "LockoutDuration")]
    [InlineData(5, "00:01:00", "-00:01:00", "IdleTimeout")]
    public void Options_validation_names_a_non_positive_key(int max, string lockout, string idle, string key)
    {
        var options = new PinOrganizerOptions
        {
            MaxFailedAttempts = max,
            LockoutDuration = TimeSpan.Parse(lockout, CultureInfo.InvariantCulture),
            IdleTimeout = TimeSpan.Parse(idle, CultureInfo.InvariantCulture),
        };

        var exception = Assert.Throws<InvalidOperationException>(options.Validate);

        Assert.Contains($"Authentication:Pin:{key}", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Default_options_are_valid()
    {
        var options = new PinOrganizerOptions();

        options.Validate();

        Assert.Equal(5, options.MaxFailedAttempts);
        Assert.Equal(TimeSpan.FromMinutes(1), options.LockoutDuration);
        Assert.Equal(TimeSpan.FromMinutes(15), options.IdleTimeout);
    }

    [Fact]
    public void The_disabled_store_refuses_every_call()
    {
        var sessions = new DisabledPinOrganizerSessions();

        Assert.Throws<InvalidOperationException>(() => sessions.SignIn(Pin));
        Assert.Throws<InvalidOperationException>(() => sessions.TryTouch("token"));
        Assert.Throws<InvalidOperationException>(() => sessions.SignOut("token"));
    }
}
