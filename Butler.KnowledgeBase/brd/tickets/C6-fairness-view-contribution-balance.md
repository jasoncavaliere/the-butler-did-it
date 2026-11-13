---
type: Ticket
title: "C6: Fairness view (contribution balance)"
description: "Fairness view: an endpoint for each person's share of completed effort and a calm balance bar in the UI."
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/25
tags: [epic:chores, area:api, area:ui, type:feature, priority:p1]
epic: ../40-epic-chores-fair-assignment.md
blocked-by: [C4]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# C6: Fairness view (contribution balance)

**Sub-service(s):** `Butler.API/`, `Butler.UI/`
**Blocked by:** C4 (`#<C4>`)
**Serves:** FR-4, BO-1, and the Section 10 fairness success metric.

## Summary
Add the fairness view: an API endpoint that aggregates completed `Effort` per person over a trailing window for the household and returns each person's share, plus a simple UI balance view that shows the distribution and highlights the top contributor's share - the Section 10 fairness guardrail.

## Context
This is journey 6.3's "fairness view" and the metric that tells us the wedge works: the top contributor's share of completed chores should trend down over time (Section 10). The aggregate is computed by scanning the household `ChoreCompletions` partition only (no cross-household query, per 7.3). This is a read-only view over data C4 already writes; it introduces no new write path.

## Acceptance Criteria
- [ ] `GET /api/households/{householdId}/fairness` (accepting an optional trailing-window length, default 4 weeks) returns, per person, the total completed `Effort` and that person's share (fraction or percentage) of the household total over the window.
- [ ] The aggregate is computed by scanning only the household's `ChoreCompletions` partition (`PartitionKey = householdId`); no cross-household query is issued.
- [ ] The share math is correct and total-safe: shares sum to 100 percent (within rounding) when there is at least one completion, and a household with zero completions in the window returns a well-formed empty/zero result rather than a divide-by-zero error.
- [ ] Unknown `householdId` returns `404` as RFC 7807 problem details.
- [ ] A UI balance view renders the per-person distribution and highlights the top contributor's share (the fairness guardrail).
- [ ] Solution builds with `TreatWarningsAsErrors`; `dotnet test` green; `npm run ci:verify` passes.

## Testing
- Gates: `cd Butler.API && dotnet build --configuration Release /p:TreatWarningsAsErrors=true && dotnet test` and `cd Butler.UI && npm run ci:verify`.
- Add tests: `FairnessAggregationTests` (API: shares computed correctly from a set of completions, shares sum to ~100 percent, zero-completion window returns a safe empty result, unknown-household-404); `FairnessView.test.tsx` (UI: renders the distribution and highlights the top contributor) with the API client mocked.

## Risks & Rollback
- R: a divide-by-zero or rounding error in the share math undermines the one metric the wedge is judged on. Mitigation: the zero-completion and sum-to-100 cases are ACs with dedicated tests. Rollback = revert; this is a P1 read-only view, so removing it does not break the C1-C5 loop.
