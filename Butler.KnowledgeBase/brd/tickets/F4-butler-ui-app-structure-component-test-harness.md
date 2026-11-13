---
type: Ticket
title: "F4: Butler.UI app structure + component test harness"
description: Real Butler.UI app structure, navigation, typed config, and a jest-expo test harness.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/6
tags: [epic:foundations, area:ui, type:chore, priority:p0]
epic: ../10-epic-foundations.md
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# F4: Butler.UI app structure + component test harness

**Sub-service(s):** `Butler.UI/`
**Blocked by:** none
**Serves:** FR-1

## Summary
Give the bare Expo app a real structure (`src/` with screens/components/state/api layers), navigation, a typed config, and a React Native test runner (jest-expo) with one passing component test, plus `lint`/`typecheck`/`test` npm scripts and a `ci:verify` aggregate.

## Context
The UI is web-first (Expo web export -> Azure Static Web App). Read the exact versioned Expo 57 docs before writing code (`Butler.UI/AGENTS.md`). This ticket sets the conventions later UI tickets (H5, T2, T3, C5, G5, O*) follow and makes `npm test`/`npm run typecheck`/`npm run lint` real gates.

## Acceptance Criteria
- [ ] A `src/` structure exists with clear folders (for example `src/screens`, `src/components`, `src/api`, `src/state`) and `App.tsx` renders a placeholder Home screen from `src/`.
- [ ] Navigation is wired (Expo Router or React Navigation - author's choice, documented) with at least a Home route.
- [ ] `jest-expo` (or the Expo-recommended RN test runner) is configured; one component test renders the Home screen and asserts visible text; `npm test` passes.
- [ ] `npm run lint`, `npm run typecheck` (or `tsc --noEmit`), and `npm test` scripts exist and pass; `npm run ci:verify` runs all three.
- [ ] A `npm run test:coverage` script collects coverage, and the jest config sets `coverageThreshold.global` to 98 for `statements`, `branches`, `functions`, and `lines`; the command fails below 98 percent. `npm run ci:verify` runs the coverage-gated test (so the 98 percent bar from [Engineering Contract 7.7](../engineering-contract/77-testing-and-definition-of-done.md) is enforced). Any exclusion (`coveragePathIgnorePatterns`) is explicit, minimal, and justified.
- [ ] `npx expo export --platform web` produces a `dist/` build with no errors.
- [ ] A typed API base config (base URL from env, dev default `http://localhost:5108`) exists for later tickets to build on.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify && npx expo export --platform web` (ci:verify includes `test:coverage` at the 98 percent global threshold).
- Add tests: `HomeScreen.test.tsx`. The Home screen and any code added here must be fully covered so the 98 percent global threshold holds from the first UI ticket.

## Risks & Rollback
- R: Expo 57 API drift. Mitigation: follow the versioned docs per `AGENTS.md`. Rollback = revert; scaffold returns to bare `App.tsx`.
