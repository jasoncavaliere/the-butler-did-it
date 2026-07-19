---
id: ADR-0001
title: Butler's brand mood and voice is the calm concierge
status: accepted
date: 2026-07-19
spike: 42
tags: [brand, voice]
supersedes: none
superseded-by: none
related: [ADR-0003, ADR-0004, ADR-0007, ADR-0009]
---

# ADR-0001: Butler's brand mood and voice is the calm concierge

## Status

`accepted`. First entry in Butler's design decision log; nothing precedes it.

## Context

Butler is a shared, always-on kitchen-wall tablet read across a room by a whole
family, kids included. The product vision is blunt that the daily action is a
pull, a glance, not a push, and that "nobody was nagged" is a feature, not a
nicety (see docs/10-product-vision.md, the Tuesday-at-the-hub scene and the
retention thesis). Most family apps die by being naggy or gamified until the
household tunes them out. Butler has to feel like help that is already handled,
so the family keeps looking at the wall because the wall is calm and true.

The mood and voice set the through-line every other decision answers to: the
palette that recedes, the copy in every state, the way fairness is framed. If we
do not fix the personality first, each screen invents its own tone.

## Decision

We will give Butler one personality: the calm concierge. It is warm, dignified,
and quietly helpful. Its voice is understated, competent, and gracious. Butler
says "Ready when you are." and "All caught up." It never says "You forgot!", it
never scolds, and it is never gamified with points, streaks, or confetti. It is
friendly and legible for kids without turning into a toy. This personality is the
through-line for every later design decision and is written to the `brand` block
in `Butler.UI/design-tokens.json` and expanded in the voice and copy guide.

## Consequences

Every piece of copy, empty state, and error now has a bar to clear: does it sound
like a gracious concierge or like a nagging app. That makes state design
(ADR-0007) and the fairness view (ADR-0009) easier to judge and harder to get
wrong. It rules out urgency patterns the rest of the industry leans on: red
overdue badges, shaming counts, leaderboards, celebratory noise. Reviewers can
reject copy on tone alone. The cost is discipline: calm is quieter than clever,
and we give up the cheap dopamine of gamification.

## Alternatives considered

- Playful and gamified (points, streaks, mascot chatter). Rejected: it is the
  exact pattern that burns out family apps, and it reads as a toy to the adults
  carrying the mental load.
- Neutral and utilitarian (a plain system tool, no personality). Rejected: it
  wastes the emotional core of the problem. The vision is explicit that the pain
  is emotionally charged; a tool with no warmth does not earn a spot on the wall.
- Crisp and corporate productivity tone. Rejected: too cold for a shared home
  surface a child also reads.
