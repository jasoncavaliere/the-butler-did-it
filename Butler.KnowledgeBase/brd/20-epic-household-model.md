---
type: Epic
title: Epic 20 - Household Model (the spine)
description: "The household spine: the household aggregate plus rooms, people, and chores CRUD, and the organizer onboarding UI."
tags: [epic:household-model]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# Epic 20 - Household Model (the spine)

**Goal:** build the household model that every other capability reads from and writes to - rooms, people, and chores, all scoped to one household. This is the durable moat: the system of record for the home. Chores, assignments, completions, and grocery all compose on top of these tables, so this epic gets the aggregate right (partition key `householdId`, optimistic concurrency, organizer-gated mutations) before anything else leans on it.

**Serves:** FR-2 and BO-2 (the household model spine).

Each ticket is its own file under `tickets/` and is a ready-to-file GitHub issue. File per [brd/filing-guide.md](filing-guide.md). Replace `#<Hn>` (and the `#<Fn>` dependency) placeholders with real issue numbers after filing. Every ticket assumes the [Engineering Contract](07-engineering-contract.md) as binding and does not restate it.

## Tickets

- [H1: Household aggregate + Households table + create/get household](tickets/H1-household-aggregate-households-table-create-get.md) - Households feature: the household aggregate, its table repository, and create and get endpoints.
- [H2: Rooms CRUD (Rooms table)](tickets/H2-rooms-crud-rooms-table.md) - Rooms feature: create, list, update, and delete rooms scoped to a household.
- [H3: People CRUD (People table) - organizer-managed roster](tickets/H3-people-crud-people-table-organizer-managed.md) - People feature: the organizer adds, lists, updates, and removes people in the household roster.
- [H4: Chores CRUD (Chores table) attached to a room](tickets/H4-chores-crud-chores-table-attached-to-a-room.md) - Chores feature: create, list, update, and deactivate chores, each attached to a room.
- [H5: UI household setup flow (organizer onboarding)](tickets/H5-ui-household-setup-flow-organizer-onboarding.md) - Organizer onboarding UI: create the household, add rooms and people, and map starter chores to rooms.

## Related

- [00-brd-master.md](00-brd-master.md) - the master BRD and its binding [Engineering Contract](07-engineering-contract.md) (Section 7).
- [brd/filing-guide.md](filing-guide.md) - core-decision rationale, label taxonomy, dependency order, and the `gh issue create` recipe.
- [10-epic-foundations.md](10-epic-foundations.md) - previous epic; F3, F6, and F7 block this one.
- [30-epic-tap-to-claim-hub.md](30-epic-tap-to-claim-hub.md) - next epic; adds the no-password tap-to-claim CLAIM action (T1) on top of this roster.
