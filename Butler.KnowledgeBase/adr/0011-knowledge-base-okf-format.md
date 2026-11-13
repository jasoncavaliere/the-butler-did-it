---
id: ADR-0011
title: The knowledge base is an OKF v0.2 bundle with one concept per file
type: Decision Record
description: Butler.KnowledgeBase follows Open Knowledge Format v0.2, and the contract and tickets are split one concept per file so agents read only what they need.
status: accepted
date: 2026-11-13
spike: none
tags: [knowledge-base, okf, token-cost, process]
supersedes: none
superseded-by: none
related: []
sources:
  - { id: okf-spec, resource: https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md, title: Open Knowledge Format v0.2 }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
verified: { by: human:jasoncavaliere, at: 2026-11-13T00:00:00Z }
---

# ADR-0011: The knowledge base is an OKF v0.2 bundle with one concept per file

## Status

`accepted` by the product owner on 2026-11-13.

## Context

Agents do most of the reading in `Butler.KnowledgeBase/`, and every file they open costs context. Two
files carried most of that cost. Each epic file (14 to 20 KB) held about six ticket specs, so working one
ticket loaded all six. The Engineering Contract (9 KB) asked readers to "read only the subsection you
need", but the only way to do that was to open the whole file. Frontmatter differed by folder: `docs/`
used the knowledge-base skill's keys, ADRs used the design-studio keys, and the epics and intake files
had none. Nothing let an agent pick a file without opening it.

Google's [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md)
v0.2 standardizes this kind of corpus: a folder of Markdown files, one concept per file, YAML frontmatter
with a required `type`, a one-sentence `description`, `index.md` files for progressive disclosure, and
optional provenance and trust keys (`sources`, `generated`, `verified`, `status`).

## Decision

We will maintain `Butler.KnowledgeBase/` as a conformant OKF v0.2 bundle:

- Every `.md` file except the indexes has frontmatter with `type`, `title`, `description`, and `tags`,
  plus `generated: { by, at }` for the last meaningful change. `sources` records what a file was derived
  from. `verified` is added only for a real review; accepted ADRs carry the owner's acceptance.
- `index.md` at the root and in `brd/` replaces the README catalogs. The root index declares
  `okf_version: "0.2"`.
- One concept per file: each Engineering Contract clause lives in `brd/engineering-contract/`, each
  ticket in `brd/tickets/<ID>-<slug>.md` (with its GitHub issue as `resource`), and each epic file is a
  short overview that lists its tickets.

We keep three deliberate deviations, all allowed by OKF's permissive conformance rules:

1. **ADR `status` keeps the ADR lifecycle** (`proposed`, `accepted`, `superseded`, `deprecated`), not
   OKF's `draft`, `stable`, `deprecated`. The design-studio scorer hard-fails any other value. Read
   `proposed` as draft, `accepted` as stable, and `superseded` as deprecated.
2. **`adr/README.md` stays** as the decision log index, with frontmatter, because design-studio
   expects that filename and would treat an `adr/index.md` as a malformed ADR.
3. **Links stay relative** rather than OKF's recommended `/`-rooted form, because `/` resolves to the
   repository root on GitHub, not to the bundle root.

The knowledge-base skill's graph keys (`category`, `lifecycle`, `owner`, `related`) stay as OKF
extension keys. `kb_score.json` at the bundle root tells the scorer which keys are required.

## Consequences

- An agent working a ticket opens one ticket file (about 0.7k tokens) and the one or two contract clauses
  it links, instead of a whole epic (about 4 to 5k tokens) and the whole contract (about 2.3k tokens).
- `grep -rh "^description:"` lists every file's purpose without opening any file.
- Tickets and GitHub issues still both exist. The issue is what `/implement-issue` works from; the
  ticket file is the canonical spec and links to the issue through `resource`.
- Links inside existing GitHub issue bodies that point at old `#anchor`s in the epic files or the
  contract now land at the top of the file. The file itself still exists and lists where each part moved.
- The root of `Butler.KnowledgeBase/` no longer has a README, so GitHub shows a file list there instead
  of a rendered page. `index.md` is the first file to open.
- Writers must keep `description` accurate and update `generated` on meaningful changes. The
  knowledge-base auditor and `kb_score.py` check frontmatter completeness.

## Alternatives considered

- **Keep the current layout and only add `type`.** This makes the bundle conformant but leaves the cost
  in the epic and contract files, so it fixes the label rather than the problem.
- **Delete the ticket files and treat GitHub issues as the only spec.** This is cheaper to maintain, but
  it loses the in-repo, diffable spec and the ticket-to-contract links that agents rely on offline.
- **Adopt OKF fully, including `/`-rooted links and OKF `status` on ADRs.** This would break GitHub
  link rendering and the design-studio scorer for no reader-visible gain.
