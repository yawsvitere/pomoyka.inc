using System.Collections.Concurrent;

namespace Feed.Api.Services;

public sealed class AuthAttemptLimiter
{
    private const int MaxFailures = 5;
    private static readonly TimeSpan BlockDuration = TimeSpan.FromMinutes(1);
    private readonly ConcurrentDictionary<string, AttemptState> _attempts = new();

    public bool IsBlocked(string key, out TimeSpan retryAfter)
    {
        var now = DateTimeOffset.UtcNow;
        if (!_attempts.TryGetValue(key, out var state))
        {
            retryAfter = TimeSpan.Zero;
            return false;
        }

        lock (state)
        {
            if (state.BlockedUntil == default)
            {
                retryAfter = TimeSpan.Zero;
                return false;
            }

            if (state.BlockedUntil <= now)
            {
                _attempts.TryRemove(key, out _);
                retryAfter = TimeSpan.Zero;
                return false;
            }

            retryAfter = state.BlockedUntil - now;
            return state.BlockedUntil > now;
        }
    }

    public void RecordFailure(string key)
    {
        var state = _attempts.GetOrAdd(key, _ => new AttemptState());
        lock (state)
        {
            if (state.BlockedUntil > DateTimeOffset.UtcNow)
                return;

            state.Failures++;
            if (state.Failures >= MaxFailures)
                state.BlockedUntil = DateTimeOffset.UtcNow.Add(BlockDuration);
        }
    }

    public void RecordSuccess(string key)
    {
        _attempts.TryRemove(key, out _);
    }

    private sealed class AttemptState
    {
        public int Failures { get; set; }
        public DateTimeOffset BlockedUntil { get; set; }
    }
}
