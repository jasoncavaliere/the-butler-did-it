using System.Diagnostics.CodeAnalysis;

namespace Butler.Api.Application.Concurrency;

/// <summary>
/// The one place the optimistic-concurrency rules from Engineering Contract 7.3
/// live, so every repository (Table-backed and the in-memory fallback) enforces
/// them identically instead of hand-rolling ETag checks. Reads hand back an
/// ETag; updates must supply it as <c>If-Match</c> — missing precondition is a
/// <c>428</c>, a stale one is a <c>412</c>.
/// </summary>
public static class OptimisticConcurrency
{
    /// <summary>The wildcard <c>If-Match</c> value, matching any current version.</summary>
    public const string Wildcard = "*";

    /// <summary>
    /// Requires that a mutating caller supplied an <c>If-Match</c> ETag. Throws
    /// <see cref="PreconditionRequiredException"/> (mapped to <c>428</c>) when it
    /// is absent, blank, or whitespace.
    /// </summary>
    /// <param name="ifMatch">The caller-supplied <c>If-Match</c> ETag.</param>
    /// <returns>The validated, non-empty ETag.</returns>
    public static string RequireIfMatch([NotNull] string? ifMatch)
    {
        if (string.IsNullOrWhiteSpace(ifMatch))
        {
            throw new PreconditionRequiredException();
        }

        return ifMatch;
    }

    /// <summary>
    /// Ensures the supplied <c>If-Match</c> ETag still identifies the current
    /// stored version. The wildcard <c>*</c> matches any existing version; any
    /// other mismatch throws <see cref="PreconditionFailedException"/> (mapped to
    /// <c>412</c>). Call <see cref="RequireIfMatch"/> first so a missing
    /// precondition surfaces as <c>428</c> rather than <c>412</c>.
    /// </summary>
    /// <param name="currentETag">The ETag of the entity as currently stored.</param>
    /// <param name="ifMatch">The caller-supplied <c>If-Match</c> ETag.</param>
    public static void EnsureCurrent(string currentETag, string ifMatch)
    {
        if (string.Equals(ifMatch, Wildcard, StringComparison.Ordinal))
        {
            return;
        }

        if (!string.Equals(currentETag, ifMatch, StringComparison.Ordinal))
        {
            throw new PreconditionFailedException();
        }
    }
}
