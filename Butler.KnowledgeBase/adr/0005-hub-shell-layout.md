---
id: ADR-0005
title: Hub shell is a three-zone horizontal band with a neutral and active state
status: accepted
date: 2026-07-19
spike: 42
tags: [layout, interaction, stack]
supersedes: none
superseded-by: none
related: [ADR-0002, ADR-0003, ADR-0004, ADR-0006, ADR-0007, ADR-0008]
---

# ADR-0005: Hub shell is a three-zone horizontal band with a neutral and active state

## Status

`accepted`.

## Context

The hub is a landscape tablet on a wall, and the glance is the product. The BRD
scaffolds the shell as a header, a row of name tiles, and a "today" panel that a
later ticket fills (brd/30-epic-tap-to-claim-hub.md T2, and brd/40 C5 for the
board). So the layout has to hold two truths at once: a calm whole-household board
that anyone can read without touching anything, and a focused view once a person
taps in. It also has to be buildable with flexbox only, no CSS grid or sticky
positioning, across web, iOS, and Android.

## Decision

We will lay the hub out as a three-zone horizontal band in landscape: a header
bar with the greeting, household name, date, and sync status; a horizontal row of
name tiles; and a large "Today" panel that fills the rest. The shell has two
states. Neutral is the ambient default: names are calm and the Today panel shows
the whole household board. Active is entered when a name is tapped: that tile
lifts and its claim color washes in, that person's items glow with their claim
color-bar, glyph, and a slight elevation, and everyone else's items recede. An
idle timeout returns the shell to neutral. The three zones are nested flex
rows and columns so they build natively.

## Consequences

The board is legible with zero interaction, which is the pull the retention thesis
depends on, and the active state gives one person focus without a login or a
context switch. The zones map cleanly onto the tap-to-claim interaction (ADR-0006)
and the offline and empty states (ADR-0007) that render inside the Today panel.
Fixing a landscape band means the same screen has to reflow for the focused,
portrait organizer context (ADR-0008), which we handle by density rather than a
separate layout. Flexbox-only keeps it cross-platform but rules out grid-style
two-dimensional layouts, so complex boards stay as stacked flex rows.

## Alternatives considered

- A vertical list-first layout (phone-shaped) on the tablet. Rejected: it wastes
  the landscape wall and buries the name tiles that make claiming ambient.
- A dashboard of equal-weight cards. Rejected: it flattens hierarchy so nothing
  is the glance; the Today panel needs to dominate.
- A per-person home screen you navigate into. Rejected: it reintroduces a
  context switch and hides the shared board that is the point of a shared hub.
