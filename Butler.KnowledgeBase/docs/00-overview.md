---
name:          00-overview
title:         Overview - What Butler Is and How This Knowledge Base Works
category:      Start Here
lifecycle:     Living
owner:         agent-managed
last-reviewed: 2026-07-13
audience:      Anyone new to Butler - humans and future agents
keywords:      [overview, start here, butler, knowledge base, wiki, navigation, categories, build in public, hub and spoke]
related:       [10-product-vision, 90-glossary]
published-to:
---

# Overview - What Butler Is and How This Knowledge Base Works

> **In one line:** Butler is a shared family operating system for the home, and this knowledge base is the map to everything we know about it.

This is the first thing to read, whether you are a person joining the project or an agent about to add to it. It answers two questions: what is Butler, and how do you find your way around (and grow) these docs.

## What Butler is

Butler is a shared family operating system for the home. It runs on a tablet mounted in a common room and acts as the family's always-on coordination hub: it divides the household's work fairly, models the home itself (rooms, people, chores), and reaches into the real world to get things done, starting with ordering groceries. The bet is that a shared surface the whole family glances at beats one more app on one parent's phone. The full argument, quantified and with every v1 decision locked, is in the [Product Vision](10-product-vision.md).

## Built in public, one capability at a time

Butler is a tech experiment and a build-in-public blog series. We ship in the open, one capability at a time, and write up what we learn. This knowledge base is part of that practice: it is where the thinking lives before, during, and after each capability ships. It is meant to be read by future contributors and by the agents that help build and document Butler, so it is written to be navigable and kept true to reality rather than left to drift.

## How this knowledge base is organized

The docs are a **knowledge graph**, not a folder of files. Each article is a node, each cross-link is an edge, and this map plus the [README](../README.md) is how you move between them. The shape is **hub-and-spoke**: the [Product Vision](10-product-vision.md) is the hub, and strategy, architecture, and operations articles are spokes that grow around it over time. Right now the graph is small - three articles - and it will grow along the reserved ranges below.

**The five categories (fixed):**

| Category | What lives here |
| --- | --- |
| **Start Here** | Orientation for new readers and agents. This article. |
| **Product & Strategy** | Why Butler exists, who it is for, how it wins. The [Product Vision](10-product-vision.md) is the hub. |
| **Architecture** | How Butler is built - the household model, the store-connector abstraction, the hub. |
| **Operations** | How Butler is run, released, and maintained in practice. |
| **Reference** | Shared vocabulary and appendices. The [Glossary](90-glossary.md) lives here. |

**Reserved numeric ranges** (the filename prefix encodes reading order and category). New articles claim the next free number in their range: `10-19` Product & Strategy, `20-39` Architecture, `40-59` Operations, `90+` Reference. The full ranges and the rules for adding an article are in [HOW-TO-MAINTAIN](../HOW-TO-MAINTAIN.md).

## Where to go next

- To understand the product and the strategy: read the [Product Vision](10-product-vision.md). It is the centerpiece and every other article hangs off it.
- To look up a term: the [Glossary](90-glossary.md) defines the shared vocabulary (the Hub, tap-to-claim, store connector, north star, and the rest) so no article has to re-explain them.
- To add or change an article: follow [HOW-TO-MAINTAIN](../HOW-TO-MAINTAIN.md). Every write is a graph edit - no orphans, edges both ways.
- The source material behind all of this (the raw vision and the build brief) lives in `intake/`. Keep it; future agents need the provenance.

## Related

- [Product Vision](10-product-vision.md) - the hub of the graph and the full case for Butler.
- [Glossary](90-glossary.md) - the shared vocabulary these articles link to instead of repeating.
