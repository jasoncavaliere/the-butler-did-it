---
type: Contract Clause
title: Engineering Contract 7.5 - Cross-cutting conventions (binding for every ticket)
description: "Binding conventions for every ticket: RFC 7807 errors, optimistic concurrency via ETag, injected time, and config handling."
tags: [engineering-contract, binding]
contract: ../07-engineering-contract.md
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# 7.5 Cross-cutting conventions (binding for every ticket)

> Part of the binding [Engineering Contract](../07-engineering-contract.md). Read this clause on its own; the other clauses are listed there.

- Errors are RFC 7807 problem details via the shared `ApiExceptionHandler`.
- Input validation returns `400` with problem details; missing `If-Match` returns `428`; stale returns `412`; unknown household/entity returns `404`.
- Time and randomness are injected (a `TimeProvider`/clock and any RNG), so handlers and the assignment engine are deterministically testable.
- No secrets in source or `appsettings.json` committed values; use user-secrets locally, Key Vault in deployed envs.
- ASCII-only in this knowledge base (no em dashes, curly quotes, or ellipsis characters) - the KB scorer hard-fails them.
