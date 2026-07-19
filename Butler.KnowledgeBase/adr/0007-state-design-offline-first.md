---
id: ADR-0007
title: Every state is first class, and offline is calm not alarming
status: accepted
date: 2026-07-19
spike: 42
tags: [state, interaction, brand]
supersedes: none
superseded-by: none
related: [ADR-0001, ADR-0005, ADR-0006, ADR-0009]
---

# ADR-0007: Every state is first class, and offline is calm not alarming

## Status

`accepted`.

## Context

Offline is a whole epic for Butler, not an edge case (brd/60-epic-offline-pwa.md;
docs/10-product-vision.md, section 6.5). The last-known week has to stay glanceable
with no network, writes queue locally, and everything syncs on reconnect. On a
shared wall, an alarming red "you are offline" banner would be both wrong and
un-calm (ADR-0001): the board is still useful, so the UI should say so quietly.
Empty, loading, error, and success all need a designed answer, because a blank or
a spinner on a wall reads as broken.

## Decision

We will design every state as a first-class, calm answer. Empty is gracious, not
blank: "All caught up." Loading is a calm skeleton that keeps the last-known board
visible rather than clearing it. Offline or stale shows a quiet muted chip, for
example "Offline. Showing last synced 9:12am", never an alarming red banner, and
the board stays fully usable behind it. A queued write shows a small per-item clock
glyph that resolves to done on sync. Error uses icon and text and color together,
never color alone, with a calm recovery and a retry. Success is the quiet completed
state itself, not a celebration. These map to the `offline-chip` and `chore-item`
state specs in `Butler.UI/design-tokens.json`.

## Consequences

The hub never looks broken and never scolds, so the family keeps trusting the wall
even when the network drops. Keeping the last-known board during loading and offline
means the UI always renders from cached data first, which shapes the data layer as
much as the visuals. Requiring icon-plus-text-plus-color on errors satisfies the
color-never-alone rule (ADR-0010) and keeps errors legible to color-blind viewers.
The queued-clock-to-done pattern gives honest feedback without a modal. The cost is
that every feature must supply all of these states, not just the happy path.

## Alternatives considered

- A modal or toast for offline. Rejected: it interrupts the glance and implies the
  board is unusable when it is not.
- Blanking the board while loading or offline. Rejected: it reads as broken and
  throws away the last-known week the vision promises stays glanceable.
- Color-only status (a red or green dot). Rejected: it fails color-blind users and
  breaks the color-never-alone rule.
