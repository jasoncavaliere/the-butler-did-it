using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;

namespace Butler.Api.Application.Auth;

/// <summary>
/// Singleton <see cref="IPinOrganizerSessions"/> (#105). One global failed-attempt
/// counter (there is a single organizer PIN), constant-time PIN comparison,
/// random 256-bit Base64Url tokens, and every time read from the injected
/// <see cref="TimeProvider"/> (Engineering Contract 7.5).
/// </summary>
public sealed class PinOrganizerSessions : IPinOrganizerSessions
{
    private const int TokenBytes = 32;

    private readonly Lock _gate = new();
    private readonly Dictionary<string, DateTimeOffset> _lastUsed = new(StringComparer.Ordinal);
    private readonly byte[] _pin;
    private readonly PinOrganizerOptions _options;
    private readonly TimeProvider _clock;
    private int _failures;
    private DateTimeOffset? _lockedUntil;

    /// <summary>Creates the store for the configured PIN.</summary>
    /// <param name="pin">The configured demo PIN (already validated).</param>
    /// <param name="options">Lockout and idle-expiry tuning.</param>
    /// <param name="clock">The clock seam.</param>
    public PinOrganizerSessions(string pin, PinOrganizerOptions options, TimeProvider clock)
    {
        ArgumentException.ThrowIfNullOrEmpty(pin);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(clock);

        _pin = Encoding.UTF8.GetBytes(pin);
        _options = options;
        _clock = clock;
    }

    /// <inheritdoc />
    public PinSignInResult SignIn(string pin)
    {
        ArgumentNullException.ThrowIfNull(pin);

        lock (_gate)
        {
            var now = _clock.GetUtcNow();
            if (_lockedUntil is { } lockedUntil)
            {
                if (now < lockedUntil)
                {
                    return new PinSignInResult(PinSignInOutcome.LockedOut, null, _options.IdleTimeout, lockedUntil - now);
                }

                _lockedUntil = null;
            }

            if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(pin), _pin))
            {
                _failures++;
                if (_failures >= _options.MaxFailedAttempts)
                {
                    _lockedUntil = now + _options.LockoutDuration;
                    _failures = 0;
                }

                return new PinSignInResult(PinSignInOutcome.InvalidPin, null, _options.IdleTimeout, TimeSpan.Zero);
            }

            _failures = 0;
            PruneIdle(now);
            var token = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(TokenBytes));
            _lastUsed[token] = now;

            return new PinSignInResult(PinSignInOutcome.SignedIn, token, _options.IdleTimeout, TimeSpan.Zero);
        }
    }

    /// <inheritdoc />
    public bool TryTouch(string token)
    {
        ArgumentNullException.ThrowIfNull(token);

        lock (_gate)
        {
            if (!_lastUsed.TryGetValue(token, out var lastUsed))
            {
                return false;
            }

            var now = _clock.GetUtcNow();
            if (now - lastUsed >= _options.IdleTimeout)
            {
                _lastUsed.Remove(token);
                return false;
            }

            _lastUsed[token] = now;
            return true;
        }
    }

    /// <inheritdoc />
    public void SignOut(string token)
    {
        ArgumentNullException.ThrowIfNull(token);

        lock (_gate)
        {
            _lastUsed.Remove(token);
        }
    }

    private void PruneIdle(DateTimeOffset now)
    {
        foreach (var (token, lastUsed) in _lastUsed.ToList())
        {
            if (now - lastUsed >= _options.IdleTimeout)
            {
                _lastUsed.Remove(token);
            }
        }
    }
}
