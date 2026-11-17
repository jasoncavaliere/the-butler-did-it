---
okf_version: "0.2"
---

# Start Here

* [00 Overview](docs/00-overview.md) - What Butler is, how this knowledge base is organized, and where each kind of reader should start.
* [How to maintain](HOW-TO-MAINTAIN.md) - The rules for changing this knowledge base: OKF frontmatter, the graph-edit checklist, categories, and where each kind of file lives.

# Product & Strategy

* [10 Product Vision](docs/10-product-vision.md) - The quantified case for Butler and every locked v1 decision, including what v1 will not build. The hub of the graph.
* [11 Hub Hardware Findings](docs/11-hub-hardware-findings.md) - Research findings (2026-08-13, not a ratified decision) on which tablet the hub runs on and how it boots into Butler: a stock Android tablet in device-owner kiosk mode, not a custom OS.
* [12 Pricing Hypothesis](docs/12-pricing-hypothesis.md) - Proposed per-household yearly price points inside the vision's $40-90 band, the pilot-to-paid offer, and the willingness-to-pay questions and experiment that test them (a hypothesis, not live pricing).
* [13 Customer Interview Guide](docs/13-customer-interview-guide.md) - Twelve open questions to ask a household right after a Butler demo, each tied to the Product Vision risk, retention thesis, or business-model claim it tests, and how to run and log the conversation.
* [14 Feedback Log Template](docs/14-feedback-log-template.md) - A copy-paste template for logging each post-demo customer conversation (date, household shape, quotes, objections, pricing answers, and follow-up), with filled entries kept out of this public repo.
* [15 Pilot Success Criteria](docs/15-pilot-success-criteria.md) - Four pilot metrics read at week 4 from the organizer Insights screen, with carts from its API (weekly active households, top contributor's share, carts confirmed, distinct participants), each with a hypothesis threshold for build more, change course, or stop, derived from the Product Vision's month-3 target.
* [16 Pilot One-Pager](docs/16-pilot-one-pager.md) - The one-page offer for pilot families: what a household gets, what we ask over the six-week pilot, the four numbers we read, how its data is kept, and what happens after (a proposal for the owner to ratify).
* [17 BYO-Tablet Setup Guidance](docs/17-byo-tablet-setup-guidance.md) - How a family sets up the tablet it already owns as the Butler hub: choosing one, keeping its battery healthy on permanent power, mounting it, and locking it down (strongly recommended, with iPad Guided Access as the lighter path).
* [18 Demo Video Script and Shot List](docs/18-demo-video-script.md) - The 90-second demo video for the landing page, posts, and follow-up emails: a timed script, a shot list mapped to each step of the demo-path browser suite (#121), and a recording checklist.

# Architecture

* [20 Architecture Overview](docs/20-architecture-overview.md) - How v1 is built: a map of each locked architecture decision, linked to the binding Engineering Contract clause.

# Operations

* [40 Hub Tablet Kiosk Setup](docs/40-hub-tablet-kiosk-setup.md) - How to turn a tablet into the Butler hub, step by step: stock Android with Fully Kiosk EMM as device owner, a reclaimed Fire tablet, or an iPad with Guided Access, plus connecting it to the demo desktop, keeping it awake, capping its charge, and getting back out.
* [41 On-Device Acceptance Checklist](docs/41-on-device-acceptance-checklist.md) - The checks a person runs on the real hub hardware after setup and before a demo: five kiosk checks on the Fire + Fully Kiosk demo device, the offline-epic (#31-#34) checks in Chrome only, and a blank results table.
* [42 Demo-Day Runbook](docs/42-demo-day-runbook.md) - The checklist for a live Butler demo: the night-before commands, the on-site network fallbacks (Tailscale, phone hotspot, adb reverse), a talk track in the demo video's beat order, the reset between demos, and what to do when something breaks.

# Reference

* [90 Glossary](docs/90-glossary.md) - Every Butler term defined once: hub, tap-to-claim, store connector, organizer, participant, and the rest.

# v1 delivery spec

* [BRD](brd/) - The v1 requirements, the binding Engineering Contract (one file per clause), six epics, and one file per ticket.

# Decisions

* [Decision log](adr/) - Accepted architectural decision records. Read them before proposing design work.

# Sources

* [Intake](intake/) - Raw source material the docs were derived from. Provenance only; do not read for implementation work.
