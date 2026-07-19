---
id: ADR-0010
title: WCAG 2.1 AA is the hard accessibility floor for every artifact
status: accepted
date: 2026-07-19
spike: 42
tags: [accessibility, color, stack]
supersedes: none
superseded-by: none
related: [ADR-0002, ADR-0003, ADR-0004, ADR-0006, ADR-0009]
---

# ADR-0010: WCAG 2.1 AA is the hard accessibility floor for every artifact

## Status

`accepted`.

## Context

Butler is a shared surface used by a whole family, including children and, over
time, a range of abilities and lighting conditions. Accessibility on a wall
display is not a compliance checkbox; it is whether a kid across the room or a
color-blind parent can actually read and use the board. The stack is Expo /
react-native-web, which maps design intent onto native accessibility props, so the
design has to name roles, labels, and states for implementation to wire up. Meeting
this from the start is cheaper and more honest than bolting it on later.

## Decision

We will hold WCAG 2.1 AA as a hard floor for every design artifact. Every
foreground and background pair the design ships is declared in `contrast_pairs` in
`Butler.UI/design-tokens.json`, tagged normal, large, or ui, and passes AA in both
the light and dark themes. Touch targets are at least 44px (`min_touch_target` is
44; the hub runs larger). Color is never the only signal: the claim glyph carries
identity alongside color (ADR-0003), and errors use icon and text as well as color
(ADR-0007). There is a visible focus-ring token with at least 3:1 contrast, reduced
motion is respected (ADR-0006), and text scales to 200 percent without loss of
content. A decorative hairline border is exempt from the 3:1 rule because it carries
no meaning; a separate `border-strong` role is used and declared for meaning-carrying
boundaries such as inputs.

## Consequences

The palette (ADR-0002), the claim colors (ADR-0003), and the type scale (ADR-0004)
were all tuned against this floor, and the deterministic scorer can verify the
contrast pairs on every change, so a regression is caught mechanically rather than
by eye. Naming roles, labels, and states in the tokens gives implementation concrete
accessibility props to wire. The constraint is real: some warm, low-chroma colors we
might have liked did not pass and had to be darkened or lightened, and every new pair
we ship from now on has to be declared and must pass before it lands.

## Alternatives considered

- Treat accessibility as a later audit. Rejected: retrofitting contrast and targets
  is more expensive and usually leaves gaps, and it contradicts a shared-family
  surface.
- Target only WCAG A. Rejected: A does not require the 4.5:1 text contrast that
  glance-distance reading on a wall actually needs.
- Verify contrast by eye or by designer judgment. Rejected: it is not reproducible;
  a pinned deterministic scorer over declared pairs is.
