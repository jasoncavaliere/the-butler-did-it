---
name:          HOW-TO-MAINTAIN
title:         How to Maintain the Butler Knowledge Base
category:      Start Here
lifecycle:     Living
owner:         agent-managed
last-reviewed: 2026-07-13
audience:      Wiki maintainers - humans and agents
related:       []
---

# How to Maintain the Butler Knowledge Base

How this knowledge base stays correct and navigable as Butler grows, one capability at a time. Read this before you add or change anything.

## The model in one sentence

**The Markdown in this repo is canonical.** Any published copy elsewhere (an external wiki, a blog mirror, a rendered site) is downstream. Edit the repo, publish outward, never hand-edit the mirror. Publishing to a mirror is a human's step, not something an agent does automatically.

## Every write is a graph edit

The docs are a hub-and-spoke knowledge graph (see the [README](README.md) map). A correct article that is unreachable or unlinked is a defect, not a deliverable. So adding, renaming, or removing an article is never just a file write - in the same change you must:

1. Write or edit the `.md` file under `docs/` (or `README.md` / this file at the root).
2. Add the article to the [README](README.md) catalog under its category, and to the right row of the by-role table.
3. Add the reciprocal `related:` edge on every neighbor. Edges are bidirectional: if A lists B, B must list A. The current seed edges are overview <-> vision, overview <-> glossary, and vision <-> glossary.
4. Make sure the article is reachable - linked from the README catalog and from at least one sibling's `## Related` section.
5. Bump `last-reviewed:` on every article whose content you touched.

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

Every article's `lifecycle:` frontmatter says which it is. If unsure, it is Living. All four seed articles are Living, including the Product Vision - as decisions evolve, revise the vision in place rather than freezing it.

## Frontmatter convention

Every article under `docs/` carries this YAML header:

```yaml
name:          <file slug, matches the filename without .md>
title:         <human title>
category:      <one of: Start Here | Product & Strategy | Architecture | Operations | Reference>
lifecycle:     Living | Record
owner:         agent-managed
last-reviewed: YYYY-MM-DD
audience:      <who this is for>
keywords:      [term, term, ...]   # search/findability terms
related:       [slug, slug, ...]   # bidirectional edges
published-to:                       # filled in only after a first publish to a mirror; leave blank until then
```

This is hub-and-spoke, not a pipeline, so articles do NOT carry a `<!-- pipeline-nav -->` prev/next line. Do not add one.

## Sources and provenance

The raw source vision and the build brief live in `intake/`. They are the provenance for everything in `docs/` - future agents need them to check claims and understand why decisions were made. Keep them. Do not edit them to change the docs; edit the Markdown in `docs/` instead. Every quantitative claim in an article must carry a source (see the Sources section of the [Product Vision](docs/10-product-vision.md) for the pattern).

## Before you finish

- Every internal link resolves and points at a real heading anchor.
- Every article has its H1, its `> **In one line:**` TL;DR callout, and a `## Related` section whose links match its `related:` frontmatter.
- Plain ASCII prose only: no em dashes, curly quotes, ellipsis characters, or non-breaking spaces. A usability scorer hard-fails these.
- If a `tools/kb_score.py` is available, run it against this directory to catch link rot, orphans, one-directional edges, and character-hygiene failures before they accumulate.
