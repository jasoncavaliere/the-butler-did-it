---
id: ADR-0002
title: Warm-ivory and deep-teal base palette with first-class dark mode
status: accepted
date: 2026-07-19
spike: 42
tags: [color, brand, accessibility]
supersedes: none
superseded-by: none
related: [ADR-0003, ADR-0005, ADR-0008, ADR-0010]
---

# ADR-0002: Warm-ivory and deep-teal base palette with first-class dark mode

## Status

`accepted`.

## Context

The hub is on a kitchen wall all day and often into the night, so both a light
and a dark palette are real, not one theme with the other bolted on later. The
personality is the calm concierge (ADR-0001), so the base has to feel warm and
dignified and, above all, recede: the thing that should draw the eye is a
person's claim color glowing (ADR-0003), not the app's own accent. The existing
Butler.UI scaffold already leans warm and dark (a deep green-black card, a warm
ink text, a brass accent in App.tsx), so a warm-ivory and deep-teal system
continues the direction the workspace already set rather than inventing a new
brand. Accessibility is a hard floor (ADR-0010): every shipped pair must pass
WCAG 2.1 AA in both themes.

## Decision

We will use a warm-ivory and deep-teal base palette with light and dark both
first class. Light is ivory `bg #FAF7F2`, white `surface`, near-black warm
`text #22201C`, and a deep pine `primary #0F5A54`. Dark is warm-black
`bg #16130F`, `surface #211D18`, warm off-white `text #F2EDE4`, and a lighter
teal `primary #4FB3A8` so the accent still reads on the dark ground. Both themes
carry calm `success` and `danger` roles (never lurid). The teal primary is
deliberately quiet so claim colors do the glowing. Canonical values live in
`colors` and `colors_dark` in `Butler.UI/design-tokens.json`; a decorative
hairline `border` and a meaning-carrying `border-strong` are separated so
component boundaries pass 3:1 while decorative hairlines stay soft.

## Consequences

Every later surface reads from these two token sets, and theme switching is a
provider swap of the token object, which is how react-native-web wants it. Fixing
the primary as a receding pine constrains us: we cannot later lean on the brand
color for emphasis or urgency, because that job belongs to claim colors and to
calm state roles. Because the primary is a low-chroma pine, claim colors and any
accent must be chosen to stand clear of it (ADR-0003). The warm base also nudges
the type and component choices toward soft, humanist forms (ADR-0004).

## Alternatives considered

- A cool grey or blue-grey neutral base. Rejected: it reads clinical and cold on
  a home surface and clashes with the warm concierge personality.
- A single dark-only theme (the scaffold started dark). Rejected: a kitchen in
  daylight needs a light theme; dark-only would be unreadable at a sunny glance.
- A vivid, saturated brand color as primary. Rejected: it competes with the claim
  colors for attention, and the whole point is that the person's color glows, not
  the app's.
