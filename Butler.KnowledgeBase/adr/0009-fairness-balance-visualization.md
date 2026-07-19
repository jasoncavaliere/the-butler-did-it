---
id: ADR-0009
title: Fairness is a calm balance bar, not a leaderboard
status: accepted
date: 2026-07-19
spike: 42
tags: [state, brand, accessibility]
supersedes: none
superseded-by: none
related: [ADR-0001, ADR-0003, ADR-0007, ADR-0010]
---

# ADR-0009: Fairness is a calm balance bar, not a leaderboard

## Status

`accepted`.

## Context

Fairness is the wedge and the emotional core: the vision is about making invisible
labor visible and showing the load trending toward balance, with the top
contributor's share falling over time (docs/10-product-vision.md; brd/40 C6, the
fairness view). But the same data shown as a ranked leaderboard would turn a shared
home into a competition and would punish, not thank, the person carrying the most.
That directly contradicts the calm concierge personality (ADR-0001). The honest
requirement is to show the shares, because hiding them keeps the labor invisible,
while the framing has to read as shared equilibrium.

## Decision

We will visualize fairness as one horizontal proportional balance bar. Each
person's share of the completed load is a segment sized to their proportion, in
their claim color and marked with their glyph (ADR-0003), and the whole bar is
framed as "trending toward even" with a gentle "balanced" state. It is not a ranked
list, there is no number one, no numbers-first display, and no leaderboard. The
shares stay honest and visible, but the reading is shared equilibrium, not a
contest. The segment spec lives as `balance-bar-segment` in
`Butler.UI/design-tokens.json`.

## Consequences

The view makes the distribution visible, which is what tells the household the
wedge is working, without shaming anyone, which is what keeps them using it. Reusing
claim colors and glyphs means the balance bar reads with the same identity language
as the rest of the hub and stays legible in grayscale. Framing by proportion rather
than count means a person with fewer but heavier chores is represented fairly by
effort, matching the fair-assignment engine's effort model. The constraint is that
we must never surface a rank or a "winner", even if a stakeholder asks, without a
new ADR that supersedes this one.

## Alternatives considered

- A ranked leaderboard with a top contributor. Rejected: it makes the home a
  competition and shames the person doing the most, the opposite of the goal.
- Raw numbers or a percentage table. Rejected: numbers-first reads as scorekeeping
  and buries the "trending toward even" story.
- Hiding shares entirely to avoid conflict. Rejected: it keeps the labor invisible,
  which is the exact problem Butler exists to solve.
