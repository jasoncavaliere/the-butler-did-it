---
type: Ticket
title: "F7: UI API client + household context provider"
description: Typed UI API client (errors, ETag passthrough) and a HouseholdContext provider for the current householdId.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/9
tags: [epic:foundations, area:ui, type:feature, priority:p1]
epic: ../10-epic-foundations.md
blocked-by: [F3, F4]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# F7: UI API client + household context provider

**Sub-service(s):** `Butler.UI/`
**Blocked by:** F3 (`#<F3>`), F4 (`#<F4>`)
**Serves:** FR-1, FR-2

## Summary
Provide a typed fetch client (base URL, error handling to a common shape, `If-Match`/`ETag` passthrough) and a `HouseholdContext` React provider that holds the current `householdId` and exposes it to screens, so later UI tickets do not each reinvent data access.

## Context
Sets the UI data-access convention. Offline behavior is layered on in Epic 60 (this client exposes the seam an offline queue will wrap). No network calls to real endpoints are required yet - the client is validated against the F1 `System`/`/me` endpoints or mocked.

## Acceptance Criteria
- [ ] A typed API client wraps fetch: injects base URL, sets JSON headers, surfaces `ETag` on reads and sends `If-Match` on updates, and normalizes errors (including RFC 7807 problem details) to a common result type.
- [ ] A `HouseholdContext` provider exposes the current `householdId` and a setter; a hook (`useHousehold`) reads it.
- [ ] The Home screen consumes the client to show a health/`/me` value (proves the wiring), with a graceful state when the API is unreachable.
- [ ] Unit tests cover the client (header injection, error normalization) with a mocked fetch, and the context hook.
- [ ] `npm run ci:verify` passes.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify`.
- Add tests: `apiClient.test.ts`, `useHousehold.test.tsx`.

## Risks & Rollback
- Low. Rollback = revert; later UI tickets would then wire their own fetch (undesirable), so land before H5.
