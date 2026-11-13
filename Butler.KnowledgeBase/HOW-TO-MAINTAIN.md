---
type: Guide
title: How to Maintain the Butler Knowledge Base
description: "The rules for changing this knowledge base: OKF frontmatter, the graph-edit checklist, categories, and where each kind of file lives."
category: Start Here
lifecycle: Living
owner: agent-managed
related: []
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# How to Maintain the Butler Knowledge Base

How this knowledge base stays correct and navigable as Butler grows, one capability at a time. Read this before you add or change anything.

## The model in one sentence

**The Markdown in this repo is canonical.** Any published copy elsewhere (an external wiki, a blog mirror, a rendered site) is downstream. Edit the repo, publish outward, never hand-edit the mirror. Publishing to a mirror is a human's step, not something an agent does automatically.

## Every write is a graph edit

The docs are a hub-and-spoke knowledge graph (see the [index](index.md) map). A correct article that is unreachable or unlinked is a defect, not a deliverable. So adding, renaming, or removing an article is never just a file write - in the same change you must:

1. Write or edit the `.md` file under `docs/` (or this file at the root).
2. Add the article to the [index](index.md) under its category heading, as `* [Title](path) - <its description>`, and to the right row of the by-role table in the [Overview](docs/00-overview.md).
3. Add the reciprocal `related:` edge on every neighbor. Edges are bidirectional: if A lists B, B must list A. The current seed edges are overview <-> vision, overview <-> glossary, and vision <-> glossary.
4. Make sure the article is reachable - linked from the index and from at least one sibling's `## Related` section.
5. Set `generated:` to `{ by: <actor>, at: <now> }` on every article whose content you meaningfully changed (not for a link or typo fix).

Do not leave a new page orphaned or an edge one-directional. Those are the two most common defects.

## Categories and reserved numeric ranges

The category set is fixed at five. The filename prefix encodes both reading order and category, so a new article claims the next free number in its range:

| Range | Category | What goes here |
| --- | --- | --- |
| `00-09` | Start Here | Orientation. `00-overview.md` and this file. |
| `10-19` | Product & Strategy | The vision (hub) and strategy articles that split off it. |
| `20-39` | Architecture | How Butler is built - household model, store-connector, the hub. |
| `40-59` | Operations | How Butler is run, released, and maintained. |
| `90+` | Reference | Glossary and appendices. |

The Product Vision (`10`) is intentionally one article because it is one idea. As a section of it grows enough to stand alone, split it into its own `1x` article, catalog it, and wire its edges - do not let the vision bloat into a wall of text.

## Two kinds of document

| | **Living** | **Record** |
| --- | --- | --- |
| Purpose | Current reference, kept true to reality | A point-in-time snapshot of a decision or state |
| When it is wrong | **Fix it in place** | **Do not edit** - supersede it with a new dated article and link forward |

Every article's `lifecycle:` frontmatter says which it is. A superseded Record article also gets OKF `status: deprecated`. If unsure, it is Living. All four seed articles are Living, including the Product Vision - as decisions evolve, revise the vision in place rather than freezing it.

## Frontmatter convention (OKF v0.2)

This knowledge base is an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md) v0.2 bundle (see [ADR-0011](adr/0011-knowledge-base-okf-format.md)). Every `.md` file except `index.md` and `adr/README.md` is a concept and starts with YAML frontmatter. `type` is required; `title`, `description`, and `tags` are expected on every file. Articles under `docs/` also carry this skill's graph keys:

```yaml
type:        <Guide | Product Vision | Architecture | Glossary | ...>   # OKF, required
title:       <human title>
description: <one sentence; it is copied into index.md and read by agents to pick a file>
tags:        [term, term, ...]          # up to about 8
category:    <Start Here | Product & Strategy | Architecture | Operations | Reference>
lifecycle:   Living | Record
owner:       agent-managed
related:     [slug, slug, ...]          # bidirectional edges
sources:                                # optional; what this was derived from
  - { id: <key>, resource: <url or relative path>, title: <label> }
generated:   { by: <actor>, at: YYYY-MM-DDTHH:MM:SSZ }   # last meaningful change
verified:    { by: human:<id>, at: YYYY-MM-DDTHH:MM:SSZ } # only when a person has reviewed it
```

Actors follow OKF: `claude-code/<model>` for an agent, `human:<github-login>` for a person, `process:<name>` for a script. Use `verified` only for a real human or automated check, never as a default. Links are relative paths (not OKF's `/`-rooted form) so they also resolve on GitHub.

The `description` is the most important field for cost: an agent can run `grep -rh "^description:" Butler.KnowledgeBase` to choose a file without opening any. Write it as one plain sentence that says what the file answers.

## Bundle layout (one concept per file)

| Path | `type` | Rule |
| --- | --- | --- |
| `index.md`, `brd/index.md` | (index) | OKF index: no frontmatter except `okf_version` at the root; `# Heading` sections of `* [Title](path) - description` lines. |
| `docs/NN-*.md` | per article | The knowledge graph. Scored by `kb_score.py` (overrides in `kb_score.json`). |
| `brd/07-engineering-contract.md` | Engineering Contract | A short overview that lists the clauses. |
| `brd/engineering-contract/7N-*.md` | Contract Clause | One clause per file. A ticket links the clause it relies on, never the whole contract. |
| `brd/NN-epic-*.md` | Epic | Goal, what it serves, and a list of its tickets. No ticket bodies. |
| `brd/tickets/<ID>-<slug>.md` | Ticket | One ticket per file. `resource:` is its GitHub issue; `tags:` are its labels. |
| `brd/ticket-issue-map.md` | Crosswalk | Generated by `brd/tools/generate_issue_map.py`. Never hand-edit. |
| `adr/NNNN-*.md`, `adr/README.md` | Decision Record, Decision Log | Owned by the design-studio skill. ADRs keep their own `status` values (proposed, accepted, superseded, deprecated) because that skill's scorer requires them. |
| `intake/*.md` | Source | Provenance. Never edit the body; never read it for implementation work. |

When a file grows past one idea, split it and link the parts. Do not copy content between files.

This is hub-and-spoke, not a pipeline, so articles do NOT carry a `<!-- pipeline-nav -->` prev/next line. Do not add one.

## Sources and provenance

The raw source vision and the build brief live in `intake/`. They are the provenance for everything in `docs/` - future agents need them to check claims and understand why decisions were made. Keep them. Do not edit them to change the docs; edit the Markdown in `docs/` instead. Every quantitative claim in an article must carry a source (see the Sources section of the [Product Vision](docs/10-product-vision.md) for the pattern).

## Before you finish

- Every internal link resolves and points at a real heading anchor.
- Every article has its H1, its `> **In one line:**` TL;DR callout, and a `## Related` section whose links match its `related:` frontmatter.
- Plain ASCII prose only: no em dashes, curly quotes, ellipsis characters, or non-breaking spaces. A usability scorer hard-fails these.
- Every non-index `.md` file has parseable frontmatter with a non-empty `type` (OKF conformance).
- If a `tools/kb_score.py` is available, run it against this directory to catch link rot, orphans, one-directional edges, and character-hygiene failures before they accumulate.
