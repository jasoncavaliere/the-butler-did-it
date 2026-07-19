---
id: ADR-0008
title: One token system, two densities for the hub and organizer contexts
status: accepted
date: 2026-07-19
spike: 42
tags: [layout, typography, stack]
supersedes: none
superseded-by: none
related: [ADR-0002, ADR-0004, ADR-0005]
---

# ADR-0008: One token system, two densities for the hub and organizer contexts

## Status

`accepted`.

## Context

Butler has two real contexts. The hub is the ambient shared surface: landscape,
jumbo type, no login, read across a room. Organizer flows are different work:
onboarding, sign-in, and confirm-purchase are done by one person on a phone, in
portrait, with normal forms and auth chrome (brd/30 T4, brd/50 grocery confirm,
brd/10 onboarding). They should feel like the same product, not two brands, but a
display-44 heading and a 64px row that suit the wall are wrong on a phone form.

## Decision

We will use one token system with two densities rather than a sub-brand. The hub
is the ambient density: jumbo sizes, landscape, 64px-plus rows, display and title
headings, no auth. Organizer flows are the focused density: portrait and
phone-friendly, standard rows around 48px, title rather than display headings, and
normal form and auth chrome. Both densities read from the same palette (ADR-0002),
type family and scale (ADR-0004), and components; only the density tokens change.
The two configurations are recorded in the `density` block in
`Butler.UI/design-tokens.json`.

## Consequences

A component built once works in both contexts by swapping the density, which keeps
the codebase and the brand unified and means a fix in one place lands everywhere.
The organizer flows inherit the calm concierge voice and the accessible palette for
free. The constraint is that every interactive component has to be authored to
accept a density, and the 44px floor still holds in the focused density even though
rows are smaller. It also means we never fork a second design language when the
organizer surface grows.

## Alternatives considered

- A separate organizer sub-brand or theme. Rejected: two brands to maintain and a
  jarring seam between the shared hub and the organizer's phone.
- One density everywhere. Rejected: hub-jumbo sizing is unusable on a phone form,
  and phone-standard sizing is unreadable on the wall.
- A fully responsive single layout with no density concept. Rejected: the two
  contexts differ in more than width (auth chrome, orientation, reading distance),
  so a density switch is the honest lever.
