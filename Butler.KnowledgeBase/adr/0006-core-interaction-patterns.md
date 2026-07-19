---
id: ADR-0006
title: Tap to claim, optimistic completion, idle return, gentle motion
status: accepted
date: 2026-07-19
spike: 42
tags: [interaction, accessibility, state]
supersedes: none
superseded-by: none
related: [ADR-0005, ADR-0007, ADR-0010]
---

# ADR-0006: Tap to claim, optimistic completion, idle return, gentle motion

## Status

`accepted`.

## Context

Participation has to be ambient and instant: no password, ever, and no waiting on
the network to feel the result of a tap (brd/30 T3, brd/40 C4/C5). The hub is
shared and always on, so state must not linger on one person after they walk away,
both for privacy and to return to the ambient glance. And the personality is calm
(ADR-0001), so nothing shakes, flashes, or nags. Butler is also offline-tolerant
by design, so a completion has to record locally and sync later without the person
ever seeing a failure for being offline.

## Decision

We will use these core interactions. Tapping a name enters the active state for
that person (ADR-0005). Tapping a chore moves it to a completed state optimistically
and instantly: it settles into a muted "done" with a check and a brief undo
affordance, and the write is recorded, or queued locally if offline, and reconciled
on sync. An idle timeout returns the shell to the neutral glance so no per-person
state lingers. Touch targets have a 44px floor, but hub name tiles and chore rows
run much larger, around 64px and up, because they are pressed at a glance from
across a room. Motion is gentle and quick, 150 to 250ms, and always respects the
reduced-motion preference. There is never a red shaking "overdue" nag.

## Consequences

The tap feels immediate because the UI does not wait on the server, which is what
makes a shared wall feel responsive, and the queue-and-sync path means offline is
invisible in the moment (the details live in ADR-0007). The undo affordance makes
optimism safe: a wrong tap is one tap back. The idle return keeps the hub honest
about who is acting, so completions are attributed correctly and no one's view is
left open. Large targets cost vertical space, which the layout budgets for. Gentle,
reduced-motion-aware animation rules out attention-grabbing transitions that would
break the calm.

## Alternatives considered

- Confirm-before-complete (a modal or a second tap). Rejected: it adds friction to
  the one-tap habit the wedge depends on and feels bureaucratic.
- Pessimistic completion (wait for the server, then update). Rejected: it makes
  the hub feel slow and breaks completely offline, which the vision forbids.
- Keeping the active person until they explicitly log out. Rejected: there is no
  logout on a no-password shared device, and stale state leaks the wrong actor.
