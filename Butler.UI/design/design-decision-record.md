---
title: Butler design foundation - brand, palette, type, hub, states, and access
spike: 42
status: accepted
audience: engineers, PM, brand
last-reviewed: 2026-07-19
supersedes: none
related: [Butler.KnowledgeBase/adr/README.md, Butler.KnowledgeBase/docs/10-product-vision.md]
---

# Butler design foundation

> Butler is a shared, always-on kitchen tablet for a whole family. This record sets
> its first design foundation: a calm concierge voice, a warm-ivory and deep-teal
> palette with a real dark mode, six claim colors that each carry a glyph, one
> humanist sans read at glance distance, a three-zone hub layout, first-class offline
> states, and WCAG 2.1 AA as a hard floor. The one constraint above all: the app
> recedes so the person's claim color is the thing that glows.

## Context

The product vision is clear about what Butler is: a shared wall tablet in the
kitchen, read across a room, used hands-free by a whole family including children.
The daily action is a glance rather than a nag, because nobody logs in and nobody is
nagged (see `Butler.KnowledgeBase/docs/10-product-vision.md`). Anyone taps their name
and the things that are theirs glow, while the organizer signs in only for billing,
teardown, and purchases (`brd/30-epic-tap-to-claim-hub.md`).

Two facts shape every choice here. First, the hub is glanced at from a distance, so
type and touch targets run considerably larger than a phone would need. Second,
Butler is offline-tolerant by design, so the last known week stays glanceable, writes
queue locally, and everything reconciles on reconnect (`brd/60-epic-offline-pwa.md`).
The existing `Butler.UI/` scaffold already leans warm and dark, with a green-black
card, warm ink text, and a brass accent, so this foundation continues that
established direction rather than inventing an unfamiliar new brand.

Because this is greenfield, the job is to establish the direction once and then
conform to it everywhere afterward. There were no prior accepted ADRs to read, so
this spike creates the decision log itself.

## Constraints

- Platform: cross-platform Expo (web, iOS, Android via react-native-web). Flexbox
  only, per-component token styles, touch-first. No web-only CSS that breaks native.
- Accessibility: WCAG 2.1 AA is a hard gate. Contrast, 44px targets, visible focus.
- Brand: greenfield. This record establishes the direction; later work conforms.
- Offline: the board must stay usable and calm with no network.
- Shared device: no participant login; state must not linger on one person.

## Options considered

The dialogue settled nine decisions, which became ten ADRs. The one color decision
splits into two records, because a base palette and a claim-color identity system are
independently supersedable: the base palette is ADR-0002, and the claim colors are
ADR-0003. Each row below is the direction chosen against the main alternative it beat,
and every row maps to one of the ten ADRs listed later in this record.

| Decision | Chosen | Main alternative rejected |
| --- | --- | --- |
| Brand mood and voice | Calm concierge, understated and gracious | Playful and gamified |
| Base palette | Warm ivory and deep teal, light and dark | Cool grey or a vivid brand color |
| Person identity | Six claim colors, each with a glyph | Color only, or avatars |
| Typography | One humanist sans, 1.25-based scale, 18px body | A geometric sans or a serif |
| Hub layout | Three-zone horizontal band | A vertical list or an even card grid |
| Interaction | Tap to claim, optimistic completion, idle return | Confirm dialogs or pessimistic writes |
| States | Every state calm; offline is a quiet chip | A red offline banner or a blank board |
| Two contexts | One token system, two densities | A separate organizer sub-brand |
| Fairness view | A calm proportional balance bar | A ranked leaderboard |
| Accessibility | WCAG 2.1 AA as a hard floor, verified by a scorer | AA as a later audit, or judging by eye |

## Decision

We chose all nine decisions in the table above, and they became the ten ADRs listed
later, since the color decision splits into a base palette and a claim-color identity
record. In short, Butler speaks as a calm concierge, and its base is warm ivory and
deep teal with a first-class dark mode where the teal recedes on purpose. Six claim
colors each pair with a glyph and a name, so identity survives even when color is
removed entirely. Type is one warm humanist sans on a 1.25-based scale with an 18px
body floor, read at a considerable distance; the steps are close to but not all
exactly 1.25, and the display hero sits two steps above title (28 -> 35 -> 44) for a
bolder size. The hub itself is a three-zone band of a header, a name-tile
row, and a large Today panel, with a calm neutral state and an active state where one
person's items glow while everyone else recedes. Taps are optimistic and reversible,
and an idle timeout quietly returns the shell to neutral. Every state is deliberately
designed, and offline is a quiet chip rather than an alarm. One token system serves
both the ambient hub and the focused organizer flows at two densities, and fairness
is one proportional balance bar that reads as shared equilibrium.

## Rationale

Each choice ties back to the vision. The calm voice exists because naggy family apps
churn, and the retention thesis is deliberately a pull, a glance, rather than a push.
The palette recedes so the claim glow reads as a person rather than as chrome, which
is exactly why blue is kept clearly apart from the teal primary. Claim colors each
carry a glyph because color alone fails color-blind users and also fails at a glance
and at an angle. Large type and large targets follow directly from reading the wall
across a room, and the three-zone band keeps the shared board legible with zero taps,
which is the ambient glance the product sells.

Optimistic, reversible taps make the one-tap habit feel instant and keep it working
offline, while the idle return prevents a shared device from ever leaking the wrong
actor into a completion. Calm states exist because a blank board or a red banner reads
as broken on a wall that is actually still perfectly useful. One token system at two
densities keeps the organizer phone flows feeling like the same product without a
second brand to maintain separately. The balance bar makes invisible labor visible,
which is the wedge, while deliberately refusing the leaderboard that would shame the
person doing the most. Accessibility is a hard floor because a shared family surface
is precisely where it matters, and a pinned deterministic scorer keeps it honest.

Every color pair was checked against WCAG 2.1 AA in both themes before it landed.
Nothing here needs a web-only feature; it all builds with flexbox, per-component
token styles, and RN primitives.

## Design tokens

The canonical values live in `Butler.UI/design-tokens.json`, which the scorer reads.
Highlights:

- Palette light: bg `#FAF7F2`, surface `#FFFFFF`, text `#22201C`, muted `#6B6259`,
  primary `#0F5A54`, on-primary `#FFFFFF`. Dark: bg `#16130F`, surface `#211D18`,
  text `#F2EDE4`, primary `#4FB3A8`. Both carry calm success and danger roles.
- Claim colors: berry (star), marigold (sun), grass (leaf), blue (wave), violet
  (moon), clay (fox). Each has a light and a dark variant plus an on-claim token for
  filled chips.
- Type scale (1.25-based): caption 14, body 18, subhead 22, title 28, display 44. The
  steps are close to but not all exactly 1.25; display sits two steps above title
  (28 -> 35 -> 44) for a stronger hero. One warm humanist sans in weights 400, 600,
  and 700, with a body line-height near 1.4.
- Spacing on a 4px base: 4, 8, 12, 16, 24, 32, 48, 64. Radii sm, md, lg, and pill.
- Touch target floor is 44px; hub rows and tiles run 64px and up.
- Components include button, input, card, name tile, chore item, offline chip, and
  balance-bar segment. Each references role tokens, never raw hex.
- A decorative hairline `border` is intentionally soft and is not a contrast pair; a
  `border-strong` role is used and declared for inputs and other real boundaries.

## Mockups

Self-contained, theme-aware HTML in `Butler.UI/design/mockups/`. Each is driven by
CSS variables that mirror the tokens, and each shows empty, loading, and offline
states with a light and dark toggle.

- `hub-neutral.html` - the Today layout in the neutral ambient glance.
- `hub-active.html` - the active-participant state, one person glowing, plus the calm
  balance bar.
- `tap-to-claim.html` - the name-tile claim interaction.
- `chore-board.html` - the board with a completed item and a queued item.
- `organizer-onboarding.html` - the create-household flow at focused phone density.

## Decisions recorded (ADRs)

Every decision above is written back to the repo-level decision log so it guides
future spikes. This spike created the log (`Butler.KnowledgeBase/adr/`).

- [ADR-0001](../../Butler.KnowledgeBase/adr/0001-brand-mood-and-voice.md) - calm concierge mood and voice
- [ADR-0002](../../Butler.KnowledgeBase/adr/0002-base-palette-and-dark-mode.md) - warm-ivory and deep-teal palette with dark mode
- [ADR-0003](../../Butler.KnowledgeBase/adr/0003-claim-color-identity-system.md) - six claim colors, each with a glyph
- [ADR-0004](../../Butler.KnowledgeBase/adr/0004-typography-scale.md) - one humanist sans, 1.25 scale, 18px body
- [ADR-0005](../../Butler.KnowledgeBase/adr/0005-hub-shell-layout.md) - three-zone hub shell layout
- [ADR-0006](../../Butler.KnowledgeBase/adr/0006-core-interaction-patterns.md) - tap to claim, optimistic completion, idle return
- [ADR-0007](../../Butler.KnowledgeBase/adr/0007-state-design-offline-first.md) - first-class states, calm offline
- [ADR-0008](../../Butler.KnowledgeBase/adr/0008-two-contexts-adaptive-density.md) - one token system, two densities
- [ADR-0009](../../Butler.KnowledgeBase/adr/0009-fairness-balance-visualization.md) - calm balance bar for fairness
- [ADR-0010](../../Butler.KnowledgeBase/adr/0010-accessibility-baseline-wcag-aa.md) - WCAG 2.1 AA hard floor

See the design-studio `references/decision-log.md` for the log model and the
consult-first rule.

## Open questions

- The claim set caps a household at six people in v1. A household with more members
  needs a follow-on decision (a seventh color, or reusing colors with distinct
  glyphs). Owner: PM plus design.
- The humanist sans is named as a role, not yet a bundled font. Whether to ship Inter
  or Nunito Sans as a bundled font, or stay on the system stack, is an implementation
  call for the hub build. Owner: UI engineering.
- The claim glyphs (star, sun, leaf, wave, moon, fox) are named but not yet drawn as
  an icon set. Producing the icon assets is a follow-on design task. Owner: design.

## What implementation tickets should consume this

Point the hub and chore tickets (brd Epic 30 T2 and T3, Epic 40 C5 and C6) and the
organizer tickets (Epic 30 T4, Epic 50 confirm) at `Butler.UI/design-tokens.json` and
at this record. Components read role tokens, never raw hex, and honor the two
densities. New colors or sizes are a deliberate token extension recorded as an ADR,
not a local one-off.
