---
type: Ticket
title: "F6: Organizer authentication seam (Entra External ID + JWT bearer, dev-mode bypass)"
description: Organizer JWT bearer auth (Entra External ID) and an Organizer policy, with a dev-mode bypass.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/8
tags: [epic:foundations, area:api, type:feature, priority:p0]
epic: ../10-epic-foundations.md
blocked-by: [F1, F2]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# F6: Organizer authentication seam (Entra External ID + JWT bearer, dev-mode bypass)

**Sub-service(s):** `Butler.API/`
**Blocked by:** F1 (`#<F1>`), F2 (`#<F2>`)
**Serves:** FR-1, FR-3

## Summary
Wire JWT bearer authentication (Entra External ID as the issuer) and an `Organizer` authorization policy, with a `DisableAuthentication` dev mode so local + CI need no live tenant. Add a `GET /me` endpoint resolving the caller.

## Context
Implements [Engineering Contract 7.4](../engineering-contract/74-authentication-and-authorization.md). Only the organizer authenticates; participants never do (that is Epic 30). Non-Development environments must fail closed when auth is misconfigured.

## Acceptance Criteria
- [ ] `Microsoft.AspNetCore.Authentication.JwtBearer` is referenced and configured for an Entra External ID authority (values from config; no secrets committed).
- [ ] An `Organizer` authorization policy is registered; a sample protected endpoint requires it.
- [ ] `Authentication:DisableAuthentication=true` (default in Development + CI) makes the policy permissive and injects a deterministic dev organizer principal; any non-Development environment with auth disabled or misconfigured fails closed (startup error or `401`/`403`).
- [ ] `GET /me` returns the resolved caller (dev organizer in dev mode; token subject otherwise).
- [ ] Tests cover: protected endpoint returns success in dev mode, and the policy denies an unauthenticated caller when auth is enabled (using test config).
- [ ] Builds clean with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build ... /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `OrganizerPolicyTests`, `DevModeAuthTests`.

## Risks & Rollback
- R-1 (BRD): a misconfigured bypass leaks to prod. Mitigation: fail-closed test above is an AC. Rollback = revert; endpoints revert to open (acceptable only pre-launch).
