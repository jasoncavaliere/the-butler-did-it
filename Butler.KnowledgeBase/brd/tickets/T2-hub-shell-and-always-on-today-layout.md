---
type: Ticket
title: "T2: Hub shell and always-on \"today\" layout"
description: "The always-on hub screen: header, participant name tiles, and the today panel region."
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/16
tags: [epic:tap-to-claim, area:ui, type:feature, priority:p0]
epic: ../30-epic-tap-to-claim-hub.md
blocked-by: [H1, F7]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# T2: Hub shell and always-on "today" layout

**Sub-service(s):** `Butler.UI/`
**Blocked by:** H1 (`#<H1>`), F7 (`#<F7>`)
**Serves:** FR-3, BO-4, BO-5

## Summary
Build the always-on hub screen: a header (household name + date), a row of participant name tiles, and a "today" panel placeholder region. This is the shared-device shell the whole product renders inside; the chore-board content that fills the today panel lands in Epic 40 C5, so this ticket renders an empty/loading today panel fed by household + people data.

## Context
This is the shell for the daily-glance journey ([6.2](../00-brd-master.md#62-the-daily-glance-any-participant-ambient)) and the surface BO-5 measures ("hub renders today's board"). It consumes household + people through the F7 API client and `HouseholdContext`; it does not fetch or render chores (that is C5's job - keep the today panel a clearly-owned empty region so C5 slots in without restructuring the layout). Web-first: read the versioned Expo 57 docs per `Butler.UI/AGENTS.md` before writing code, and follow the UI conventions F4 established.

## Acceptance Criteria
- [ ] An always-on hub screen renders three regions: a header showing the household name and the current date, a row of participant name tiles (one per person from the roster), and a clearly-bounded "today" panel placeholder region.
- [ ] Household name comes from household data (H1) and name tiles come from people data, both loaded via the F7 API client / `HouseholdContext`; a graceful loading and unreachable-API state is shown (no crash, no blank white screen).
- [ ] The today panel renders an empty/loading placeholder now and is structured so Epic 40 C5 can populate it without changing the shell layout (documented seam - for example a `TodayPanel` component that renders children).
- [ ] Layout is tablet-oriented and stays readable at glance distance (large type, high contrast, no dependence on hover); it does not assume a mouse.
- [ ] No password or sign-in prompt appears anywhere on this shell (participants glance and tap; organizer sign-in is a separate affordance from T4).
- [ ] `npm run ci:verify` passes and `npx expo export --platform web` succeeds.

## Testing
- Gates: `cd Butler.UI && npm run ci:verify && npx expo export --platform web`.
- Add tests: `HubShell.test.tsx` (renders header household name and one name tile per mocked person; renders the empty today panel; shows the unreachable-API state when the client errors).

## Risks & Rollback
- R: the shell over-specifies the today panel and boxes in C5. Mitigation: keep the panel a dumb placeholder container with a documented seam. Rollback = revert the PR; the UI returns to the F4 placeholder Home screen.
