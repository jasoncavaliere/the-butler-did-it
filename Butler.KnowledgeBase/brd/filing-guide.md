---
type: Playbook
title: Butler v1 BRD - delivery and ticket-filing guide
description: Why the core v1 decisions were made, the epic dependency order, the label taxonomy, how to file a ticket file as a GitHub issue, and the spec checklist.
tags: [brd, filing, labels, dependency-order, github-issues]
owner: product
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# Butler v1 BRD - delivery and ticket-filing guide

The [BRD](index.md) turns the [Product Vision](../docs/10-product-vision.md) into an implementable v1: a master BRD, the binding Engineering Contract, one overview file per epic, and one file per ticket under `tickets/`. Each ticket file is a ready-to-file GitHub issue written to pass the `/implement-issue` and `/merge-issue` workflows unattended - clear scope, acceptance criteria as `- [ ]` checkboxes, named gates, and no material assumptions left to guess.

The BRD is a delivery artifact derived from the vision, not a node in the `docs/` knowledge graph. It links into `docs/` but needs no reciprocal edges from the wiki.

## Why these decisions (the short rationale)

- **Azure Table Storage, not SQL.** An always-on family hub glances all day, so any option with a compute/idle floor (Azure SQL Serverless stays warm, ~$30-100/mo; Postgres Flexible ~$12-15/mo) costs real money at low scale. Table Storage is ~free at low scale (single-digit dollars/month for ~1000 households, ~$0 idle, $0 local/CI via Azurite). The household model is a natural aggregate keyed by `householdId`, so every product read/write is a single-partition operation - exactly what Table Storage is fastest and cheapest at. The relational features you would pay for (joins, ad-hoc SQL) are the ones the vision defers. Cost + fit + consistency with the proven QControl pattern all point one way.
- **Entra External ID for the organizer only.** Consumer-grade managed identity (email/social, MFA, reset handled for you) that still validates as JWT bearer, so the API-side wiring matches the QControl AAD seam. Participants never authenticate (tap-to-claim); only the organizer needs real credentials.
- **Simulated store connector behind a real seam.** HEB has no public consumer API. Shipping the real `IStoreConnector` interface with a deterministic simulated implementation makes v1 fully demoable and testable with no external dependency, and swappable later without touching product logic.

Full detail lives in [00-brd-master.md Section 5.3](00-brd-master.md#53-scope-decisions-that-resolve-would-be-material-assumptions) and [the Engineering Contract](07-engineering-contract.md).

## Dependency order (file and implement in this order)

```
Epic 10 Foundations  (F1..F7)          <- everything depends on this
        |
        v
Epic 20 Household Model (H1..H5)  ------+
        |                               |
        v                               v
Epic 30 Tap-to-Claim & Hub (T1..T5)   Epic 50 Grocery (G1..G5)
        |
        v
Epic 40 Chores & Fair Assignment (C1..C6)
        |
        v
Epic 60 Offline PWA (O1..O4)           <- best last; caches the loop that now exists
```

Within Foundations, the safe order is F1 -> F2 -> F3 -> F6 (API side) and F4 -> F5 (UI + CI) in parallel, with F7 after F3/F4. Each ticket lists its own `Blocked by`.

## Label taxonomy (create once, then reuse)

`/implement-issue` ensures its own `status:*` / `needs-*` labels exist. These are the **classification** labels the specs use; create them up front so filed issues are organized and dependency-linkable:

| Label | Meaning |
| --- | --- |
| `epic:foundations` `epic:household-model` `epic:tap-to-claim` `epic:chores` `epic:grocery` `epic:offline` | Which epic the issue belongs to. |
| `area:api` `area:ui` `area:infra` | Which sub-service / surface it touches. |
| `type:feature` `type:chore` `type:test` | Kind of work. |
| `priority:p0` `priority:p1` `priority:p2` | P0 = required for the v1 loop; P1 = important; P2 = polish. |

Create them all:

```bash
cd ~/code/butler/the-butler-did-it   # repo: the-butler-did-it
for l in epic:foundations epic:household-model epic:tap-to-claim epic:chores epic:grocery epic:offline \
         area:api area:ui area:infra type:feature type:chore type:test \
         priority:p0 priority:p1 priority:p2; do
  gh label create "$l" --force
done
```

## Filing a spec into GitHub

Each ticket file gives you a title and labels (`title:` and `tags:` in its frontmatter), a body already in issue Markdown with an `## Acceptance Criteria` checklist, and its `Blocked by` links. To file one:

1. Write the issue body (everything from `## Summary` on): `sed -n '/^## Summary/,$p' tickets/F1-*.md > /tmp/F1.md`.
2. Create the issue:

   ```bash
   gh issue create \
     --repo <owner>/the-butler-did-it \
     --title "F1: Establish Butler.API layered skeleton (MediatR + feature extensions)" \
     --body-file /tmp/F1.md \
     --label "epic:foundations,area:api,type:chore,priority:p0"
   ```

3. After the blocking issues exist, wire dependencies. GitHub has no native "blocked by" field, so either note `Blocked by #<n>` in the body (the specs already include this line - update the number after filing) or use a tracking checklist on an epic issue.

Then implement with the workflow:

```
/implement-issue <issue-number>
```

which will clarify scope, post a plan, work in an isolated worktree, add tests, run the gates, get an independent review, and open a PR. When the PR is green:

```
/merge-issue <issue-number>
```

## What makes these specs pass the workflow (checklist the author held to)

- **Acceptance criteria are `- [ ]` checkboxes and testable.** They are the contract; `/implement-issue` halts without them.
- **No material assumptions.** Scope, data model, persistence, auth, and the grocery flow are all pre-decided in the master BRD's Engineering Contract, and each ticket links to it.
- **Repo scope is explicit** (single repo `the-butler-did-it`; the ticket names which sub-service and gates apply).
- **Gates are named** so `/implement-issue` Phase 2 detection and Phase 4 verification have something concrete to run.
- **Coverage is a hard gate: 98 percent on lines, methods, and branches** in both sub-services, enforced by the build/CI (see [Engineering Contract 7.7](engineering-contract/77-testing-and-definition-of-done.md)). Foundations F2/F4 stand up the tooling and F5 enforces it in CI, so every later ticket inherits the bar.
- **Vertically sliced, ~1 PR each,** with `Blocked by` making the order safe for parallel sessions.
