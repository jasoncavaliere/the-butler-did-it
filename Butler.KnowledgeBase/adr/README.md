# Architectural Decision Log

This is Butler's design decision memory. Each Architectural Decision Record (ADR)
captures one settled decision so it guides every future spike. Read the accepted
ADRs before proposing design work, and conform to them. An accepted ADR is
immutable: never edit its Decision to match a new reality, supersede it with a new
ADR and set reciprocal `supersedes` / `superseded-by` links.

See the design-studio skill's `references/decision-log.md` for the full log model,
the status lifecycle, and the consult-first rule. Plain ASCII only, per the repo
conventions.

## How to use this log

- One decision per ADR, files named `NNNN-kebab-title.md`, ids zero-padded.
- Every write updates this index row, and any supersede link is made reciprocal.
- The decision record that produced these ADRs is
  `Butler.UI/design/design-decision-record.md`.

## Index (newest first)

| id | title | status | date | tags |
| --- | --- | --- | --- | --- |
| [ADR-0010](0010-accessibility-baseline-wcag-aa.md) | WCAG 2.1 AA is the hard accessibility floor for every artifact | accepted | 2026-07-19 | accessibility, color, stack |
| [ADR-0009](0009-fairness-balance-visualization.md) | Fairness is a calm balance bar, not a leaderboard | accepted | 2026-07-19 | state, brand, accessibility |
| [ADR-0008](0008-two-contexts-adaptive-density.md) | One token system, two densities for the hub and organizer contexts | accepted | 2026-07-19 | layout, typography, stack |
| [ADR-0007](0007-state-design-offline-first.md) | Every state is first class, and offline is calm not alarming | accepted | 2026-07-19 | state, interaction, brand |
| [ADR-0006](0006-core-interaction-patterns.md) | Tap to claim, optimistic completion, idle return, gentle motion | accepted | 2026-07-19 | interaction, accessibility, state |
| [ADR-0005](0005-hub-shell-layout.md) | Hub shell is a three-zone horizontal band with a neutral and active state | accepted | 2026-07-19 | layout, interaction, stack |
| [ADR-0004](0004-typography-scale.md) | One warm humanist sans on a 1.25 scale with an 18px body floor | accepted | 2026-07-19 | typography, accessibility, brand |
| [ADR-0003](0003-claim-color-identity-system.md) | Six claim colors, each paired with a glyph, encoded redundantly | accepted | 2026-07-19 | color, brand, accessibility, interaction |
| [ADR-0002](0002-base-palette-and-dark-mode.md) | Warm-ivory and deep-teal base palette with first-class dark mode | accepted | 2026-07-19 | color, brand, accessibility |
| [ADR-0001](0001-brand-mood-and-voice.md) | Butler's brand mood and voice is the calm concierge | accepted | 2026-07-19 | brand, voice |
