---
id: ADR-0004
title: One warm humanist sans on a 1.25 scale with an 18px body floor
status: accepted
date: 2026-07-19
spike: 42
tags: [typography, accessibility, brand]
supersedes: none
superseded-by: none
related: [ADR-0001, ADR-0005, ADR-0008, ADR-0010]
---

# ADR-0004: One warm humanist sans on a 1.25 scale with an 18px body floor

## Status

`accepted`.

## Context

The hub is read at a distance, not held in a hand, so type that is comfortable on
a phone is too small on a wall. It is also read by kids, so letterforms need to be
friendly and legible, not decorative. The personality is warm and dignified
(ADR-0001), which points at a humanist sans rather than a geometric or a
condensed face. On the Expo / react-native-web stack the system font stack is
free and native-feeling, so a font is a role we can fill with a bundled family or
fall back to the system humanist sans at zero cost.

## Decision

We will use one warm humanist sans with the character of Inter or Nunito Sans, in
weights 400, 600, and 700, on a 1.25 modular scale with an 18px minimum body size
because the hub is read across a room. The scale is caption 14, body 18, subhead
22, title 28, and display 44, with a comfortable line-height near 1.4 for body.
The steps are close to but not all exactly 1.25: 14, 18, 22, and 28 are single
steps, while display 44 sits two steps above title 28 (28 -> 35 -> 44), skipping
the roughly 35 step on purpose to give the hub a stronger hero size. So the scale
is 1.25-based, not a claim that every adjacent pair is an exact 1.25 ratio.
The font is named as a role in `type_family` in `Butler.UI/design-tokens.json`;
if a bundled font is not present, the stack falls back to the system humanist
sans. Organizer flows use the same family and scale at a smaller step (ADR-0008),
not a different typeface.

## Consequences

One family and three weights keep the system coherent and cheap to render, and
the 18px floor plus 1.4 line-height gives text room to scale to 200 percent
without breaking layout (ADR-0010). Fixing the scale means new sizes are a
deliberate extension, not a per-screen guess. The large display size suits the
hub but is too big for a phone form, which is exactly why the focused density
caps its heading at title (ADR-0008). Choosing a role over a hard-bundled font
keeps the first build light while leaving the door open to ship the real face.

## Alternatives considered

- A geometric sans (for example a Futura-like face). Rejected: geometric forms
  read colder and are less legible for children than humanist ones.
- A serif for warmth. Rejected: serifs lose legibility at glance distance on a
  backlit panel and feel more editorial than concierge.
- Two families, a display face plus a text face. Rejected: unnecessary weight and
  a coherence risk for a product whose whole value is a calm, unified glance.
