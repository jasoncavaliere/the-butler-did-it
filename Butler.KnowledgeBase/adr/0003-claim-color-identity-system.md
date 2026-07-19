---
id: ADR-0003
title: Six claim colors, each paired with a glyph, encoded redundantly
status: accepted
date: 2026-07-19
spike: 42
tags: [color, brand, accessibility, interaction]
supersedes: none
superseded-by: none
related: [ADR-0001, ADR-0002, ADR-0005, ADR-0009, ADR-0010]
---

# ADR-0003: Six claim colors, each paired with a glyph, encoded redundantly

## Status

`accepted`.

## Context

Tap-to-claim is the whole game: each person has a claim color and "what's mine
glows" (docs/10-product-vision.md; brd/30-epic-tap-to-claim-hub.md). Color alone
cannot carry identity. Some family members are color-blind, the hub is glanced at
from across a room and at an angle, and a claim color that looks like the app's
teal accent (ADR-0002) would make a glow read as chrome instead of a person. So
identity has to survive with color removed entirely, and each color has to be
mutually distinguishable and clearly separate from the primary. This is also a
hard accessibility rule: do not rely on color alone (ADR-0010).

## Decision

We will give the household six mutually distinguishable claim colors, each
permanently paired with a simple glyph and always shown with the person's name,
so identity is encoded three ways at once: color, glyph, and name. The set is
berry (star), marigold (sun), grass (leaf), blue (wave), violet (moon), and clay
(fox). Blue is a deliberate royal/sky blue kept visibly distinct from the teal
primary so a glow never reads as the accent. Each color ships a light variant and
a lighter dark variant, because a hue that works on ivory must lift on warm-black.
Claim colors are used primarily as accents: a left color-bar on a chore row, the
glyph color, and a low-alpha tint wash on the active tile, with body text kept on
`surface` for legibility. Where a claim color is a filled chip, it is paired with
an `on-claim` token (white in light, dark ink in dark) that passes AA. Values live
in `claim_colors` in `Butler.UI/design-tokens.json`.

## Consequences

The design keeps working in full grayscale, which is the real test of the
redundant encoding, and it survives a color-blind viewer. Every component that
shows a person now carries the glyph next to the color, so name tiles, chore
rows, and balance-bar segments (ADR-0009) share one identity pattern. The
household is capped at six claimable people in v1, which fits the beachhead of
families with kids. Because each color also serves as a 3:1 glyph on the surface
and can carry `on-claim` text as a filled chip, the palette had to be tuned to
hit those ratios; that tuning is recorded in the tokens and the decision record.

## Alternatives considered

- Color-only claims (no glyph). Rejected: fails color-blind users and fails the
  "works with color removed" test the vision implies.
- Avatars or photos per person. Rejected: heavier to manage, less legible at a
  glance and at distance, and a privacy surface on an always-on wall display.
- Initials only. Rejected: initials collide in families (two names starting with
  the same letter) and carry no at-a-glance color signal.
