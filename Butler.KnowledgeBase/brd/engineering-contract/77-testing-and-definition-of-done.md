---
type: Contract Clause
title: Engineering Contract 7.7 - Testing and Definition of Done (what makes a ticket's AC verifiable)
description: "The Definition of Done: named tests, the 98 percent coverage gate in both sub-services, green gates, and an approving independent review."
tags: [engineering-contract, binding]
contract: ../07-engineering-contract.md
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# 7.7 Testing and Definition of Done (what makes a ticket's AC verifiable)

> Part of the binding [Engineering Contract](../07-engineering-contract.md). Read this clause on its own; the other clauses are listed there.

A ticket is done when, in each sub-service it touches:

- New or changed behavior has automated tests that exercise it (name them in the PR). API: xUnit + NSubstitute in `src/Butler.Api.Tests`. UI: the Foundations-chosen RN test runner (jest-expo) in `Butler.UI`.
- **Code coverage is a hard gate: at least 98 percent on lines (files), methods, and branches**, enforced by the build and CI in each sub-service - the build fails below 98 percent, so a PR that lowers coverage under the bar cannot merge. API: coverlet threshold (`/p:Threshold=98 /p:ThresholdType=line,branch,method /p:ThresholdStat=total`). UI: jest `coverageThreshold.global` set to 98 for `statements`, `branches`, `functions`, and `lines`. The bar is met by writing tests, never by deleting them; any coverage exclusion must be explicit, minimal, and justified in the coverage config (for example generated code or the `Program.cs` bootstrap), not a blanket ignore.
- All applicable gates in 7.1 pass locally and in CI.
- No unrelated files changed; no new `TODO`/`FIXME` without a linked follow-up issue.
- The independent reviewer agent returns `VERDICT: 👍` (implement-issue Phase 4.5).
