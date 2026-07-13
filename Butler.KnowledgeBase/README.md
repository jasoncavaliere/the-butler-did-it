# Butler Knowledge Base - the shared family operating system for the home

This is the canonical knowledge base for **Butler** (repo: `the-butler-did-it`), a shared family operating system that runs on a kitchen tablet. It is the source of truth for what Butler is, who it is for, and how we are building it in public, one capability at a time. The Markdown here is canonical; if any of it is ever mirrored to an external wiki, that copy is downstream - edit here, publish outward, never hand-edit the mirror.

> **One-line summary:** Butler is a kitchen-tablet hub that divides the household's work fairly, models the home, and reaches into the real world to get things done - and this KB is the map to all of it.

## The knowledge graph at a glance

The docs are a graph, not a folder: articles are nodes, cross-links are edges, this page is the map. The shape is **hub-and-spoke** - the Product Vision is the hub, and strategy, architecture, and operations articles are spokes that grow around it. Reference material (the glossary) sits to the side and is linked from everywhere.

```
                 Start Here
                [00 Overview]
                 /         \
                /           \
   [10 Product Vision] --- [90 Glossary]
      (the hub)            (shared vocabulary)
         |
         |  spokes grow here as capabilities ship:
         |  20-39 Architecture  |  40-59 Operations  |  10-19 more Strategy
         v
   (future articles)
```

**Start here, read the vision, look up terms in the glossary as you go.**

## By role - where to start

| You are... | Read first |
| --- | --- |
| **New to Butler** | [00 Overview](docs/00-overview.md) then [90 Glossary](docs/90-glossary.md) |
| **Product / leadership** | [10 Product Vision](docs/10-product-vision.md) - especially What winning looks like and What we are NOT building in v1 |
| **Engineer / agent** | [00 Overview](docs/00-overview.md) for the map, [10 Product Vision](docs/10-product-vision.md) for the v1 scope and decisions, then [HOW-TO-MAINTAIN](HOW-TO-MAINTAIN.md) before you edit |
| **Investor / partner** | [10 Product Vision](docs/10-product-vision.md) - the problem, the moat, why now, and the business model, all sourced |

## Article catalog

### Start Here
| Article | Why you care |
| --- | --- |
| [00 Overview](docs/00-overview.md) | What Butler is and how to navigate and grow this KB. |

### Product & Strategy
| Article | Why you care |
| --- | --- |
| [10 Product Vision](docs/10-product-vision.md) | The full, quantified case for Butler and every locked v1 decision. The hub of the graph. |

### Architecture
| Article | Why you care |
| --- | --- |
| *(none yet - reserved `20-39`)* | How Butler is built: the household model, store-connector abstraction, the hub. |

### Operations
| Article | Why you care |
| --- | --- |
| *(none yet - reserved `40-59`)* | How Butler is run, released, and maintained. |

### Reference
| Article | Why you care |
| --- | --- |
| [90 Glossary](docs/90-glossary.md) | Every Butler term in one place, defined once. |

## Repository layout

```
Butler.KnowledgeBase/
|-- README.md              <- you are here (the index / knowledge-graph map)
|-- HOW-TO-MAINTAIN.md     <- how these docs stay correct as the graph grows
|-- docs/                  <- the articles (canonical Markdown)
|-- intake/                <- source material (raw vision + build brief); provenance, keep it
|-- assets/                <- diagrams referenced by the articles (none yet)
`-- tools/                 <- publish/score tooling (none yet)
```

## Source and maintenance

- **Origin:** derived from the raw vision (`intake/household-concierge-vision-v0.md`) and the settled build brief (`intake/vision-build-brief.md`). Those files are provenance - keep them, do not edit them to change the docs.
- **Owner:** agent-managed. **Last reviewed:** 2026-07-13.
- To change anything, edit the Markdown here and follow [`HOW-TO-MAINTAIN.md`](HOW-TO-MAINTAIN.md). Every write is a graph edit: no orphans, edges both ways.
