---
name:          10-product-vision
title:         Product Vision
category:      Product & Strategy
lifecycle:     Living
owner:         agent-managed
last-reviewed: 2026-07-13
audience:      Product, leadership, engineers, investors, and partners
keywords:      [vision, strategy, household, chores, fair assignment, grocery, store connector, hub, tap-to-claim, north star, beachhead, moat, business model, HEB, BYO-tablet, retention]
related:       [00-overview, 90-glossary]
published-to:
---

# Product Vision

> **In one line:** Butler is the shared family operating system for the home - a kitchen-tablet hub that fairly divides the household's work, models the home itself, and reaches into the real world to get things done.

This is the seed article for Butler. It is the full vision, quantified against a verified fact pack (see [Sources](#sources)), with every v1 decision locked. It stays as one article because it is one idea; as sections grow they can split into their own `1x` articles under Product & Strategy. New terms are defined once in the [Glossary](90-glossary.md) and linked, not re-explained here.

## A Tuesday at the hub

It is 7:15 on a Tuesday. The tablet on the kitchen wall is already awake, showing today: two chores, a dentist reminder, and "trash night." Maya walks past, taps her name, and the two things that are hers glow. She taps one done on her way out the door. Her dad taps his name, sees the milk is low because someone flagged it yesterday, and says "Butler, add oat milk" to the speaker on the counter. It lands in this week's cart, waiting for a human to confirm before anything is ordered.

Nobody logged in. Nobody downloaded anything. Nobody was nagged. The household just glanced at the wall and the wall was true. That glance is the product.

## The problem: invisible, unfair, unautomated

Running a home is real labor that mostly no one counts, and the counting falls hardest on one person.

- Unpaid care work done by women and girls is worth **at least $10.8 trillion a year** globally, a deliberately conservative floor valued at minimum wage [1]. The number is contested at the edges. The direction is not.
- Mothers manage about **71 percent** of household mental-load tasks; fathers about **45 percent** (rated per domain, so they do not sum to 100) [2]. A 2025 study with overlapping authors corroborates the gap: mothers report about **67 percent more** household-management tasks than fathers, **13.72 versus 8.2** on average, and higher income cuts women's physical housework but not their cognitive load [3].
- The time gap shows up in diaries too. US women average **2.8 hours a day** on household activities versus **2.1** for men; on childcare for a child under 6 it is **1.2 hours a day** for women versus about **0.6** for men [4]. Across OECD countries, women do nearly **twice as much** unpaid work as men [5].

Three failures compound:

1. **The mental load sits on one person.** One member holds the whole list in their head, tracks it, and reminds everyone else. That is the cognitive-load gap above, and it is the emotional core of the problem.
2. **The work is invisible, so it feels unfair.** No one agrees on who does how much because no one is counting. Resentment grows in the gap.
3. **Home logistics are fragmented.** Chores live in someone's head, the list on the fridge, reminders in texts, the calendar somewhere else. Nothing connects, so nothing can be automated.

This pain is recurring and emotionally charged, which is exactly why households pay to relieve it.

## Who we build for first

**Butler's beachhead is families with kids at home** - households actively juggling chores, kids, appointments, and grocery runs. There are **33.6 million US families with their own children under 18** (2025) [6], and they are the households that feel all three failures at once.

Inside that beachhead, the first champion is the [Household Organizer](90-glossary.md#household-organizer): the person carrying the mental load. They feel the pain most sharply and will bring the product home. But Butler only works if the whole household shows up, which is why the shared hub is the design (see below).

**Who Butler is NOT for yet:** roommates, single professionals, couples without kids, and eldercare coordination. Those are real markets and plausible later expansions into the **86.0 million US family households** and **134.8 million total households** [7], but v1 does not chase them. A vision is more defensible when it names who it is not for.

## The wedge and the expansion story

A defensible product leads with one thing it is best in the world at, then compounds.

**The wedge: chore mapping and fair assignment.** This is the most emotionally resonant way in - "stop the nagging, make it fair" - it creates a weekly habit, and it earns Butler a spot on the family's shared screen every day. See [Chore Mapping and Fair Assignment](90-glossary.md#chore-mapping-and-fair-assignment).

**Expansion 1: the household model.** The structured twin of the home - rooms, then people, then chores that attach to both. This is the data spine everything else reads from and writes to. See [Household Model](90-glossary.md#household-model).

**Expansion 2: real-world execution, starting with grocery.** Voice-captured lists flow into a grocery cart. This is the proof that Butler does not just track work, it does work.

The sequence: chores get us in the door, the household model makes us the system of record, and real-world execution makes us hard to remove.

## The product: a shared hub, not a phone app

**Decision: Butler's primary surface is a shared tablet mounted in a common space** - the family's always-on coordination hub. This is the single most important choice in the vision because it solves the number-one killer of household products: getting the whole family to participate.

Most family apps die because they need every member to download, log in, and open an app they do not care about. Teens and reluctant partners never do. A shared, always-on surface makes participation ambient. You walk past, tap your name, see what is yours. No install and no login for participants.

That reframes what Butler competes for. It is not fighting other to-do apps for a slot on a phone; it is competing for a physical spot in the home and for being the family's default place to look. That is a bigger and stickier position, and it drives the offline, display, and always-on choices below.

**Hardware and offline decision (v1):** bring your own tablet. Butler ships as a web app and installable [PWA](90-glossary.md#byo-tablet) that runs on any Android tablet or iPad a family already owns (roughly $100 to $150 if they buy one). It is offline-tolerant by design: the last-known week stays glanceable and readable with no network, writes queue locally, and everything syncs on reconnect. Butler-made hardware is a deliberate later step, door left open, not a v1 bet.

**Identity decision - tap-to-claim (v1):** on the hub, each participant has a [tap-to-claim](90-glossary.md#tap-to-claim) profile with no password. One [Household Organizer](90-glossary.md#household-organizer) account holds the real credentials and billing. Sensitive actions - billing, teardown, large purchases - sit behind the organizer's auth. Off the hub, Butler reaches people on channels they already have (SMS and Alexa first) so a teen or a reluctant spouse never installs anything. A mobile companion is optional and organizer-first, never required to participate. Kids get lightweight profiles with a simple parent/child flag for age-appropriate chores; full parental controls are deferred past v1.

## Real-world execution: the store-connector ladder

The destination is official grocery partnerships and APIs, HEB first. But HEB has **no public consumer-ordering API** today - only supplier and EDI surfaces, plus unofficial scrapers that self-describe as not affiliated with the retailer [16]. So Butler ships v1 against whatever is available behind a generic [Store Connector](90-glossary.md#store-connector) abstraction. The product experience never changes; only the connector swaps underneath.

The ladder:

| Stage | What it does | Who is in control |
| --- | --- | --- |
| **v1** | One connector, [assisted cart](90-glossary.md#assisted-cart), HEB-first, Alexa voice as capture | A human confirms the final tap |
| **Maturing** | Hands-off ordering on trusted connectors | Butler places the order within set limits |
| **Mature** | The household picks its own set of connectors from a catalog; Butler routes the order | The household chooses stores; Butler executes |

At maturity the store connector is a user-facing product surface, not just internal plumbing. Voice is deliberately capture, not checkout: even with a huge install base, voice-shopping conversion is thin [18], so "Butler, add oat milk" fills the cart and a human confirms.

## The retention thesis

Chore apps churn because the daily action is a push - go do a chore - and novelty fades. Butler's daily action is a pull: **glance at what is happening today.** The hub becomes the family's single glanceable source of truth for the week, so the habit is looking, not doing. Grocery execution is the recurring monthly wow that re-earns the subscription.

Be honest about the timeline: v1 proves the loop. The durable retention curve fully kicks in at v1.1, when calendar joins the glance and the wall is worth checking every morning whether or not a chore is due. The signal we watch: households still weekly-active past month 3, plus passive glances per day trending up.

## Where the moat is, in sequence

- **Execution is the demonstrable moat.** Actually ordering groceries is hard to build and hard to copy, and it is what wins early trust and press. HEB alone runs **435-plus stores** with estimated revenue of **$46.5 billion to $50 billion** (2024, trade estimate since HEB is private) [17]; connecting to that world is not a weekend project.
- **The household data model is the durable moat.** The longer a family uses Butler, the richer the twin of their home becomes - rooms, routines, who does what, preferences. That context is sticky and expensive to rebuild elsewhere.
- **The physical and habitual hub position is the footprint.** Being the always-on screen in the kitchen is hard to dislodge once you are there.

Execution wins the family. The data model keeps them.

## Why now

- **AI makes the hard parts work.** Fair assignment and natural-language capture ("add milk" by voice into a structured list into a cart) are reliable now in a way they were not a couple of years ago.
- **Ambient home screens are normalized.** **64 percent** of US households own a tablet, and **80 percent** of households with children do, versus 57 percent without [12]. About **35 percent** of Americans 12 and older own a smart speaker, roughly **101 million people**, a share that has held near a third for four years [13]. The hardware for a hub is already on the counter.
- **Online grocery is surging.** US e-grocery hit **$12.7 billion in a single month** (December 2025), about **19 percent** of grocery spend that month, up **32 percent** year over year [14]. Instacart alone did about **$9.85 billion in GTV** across roughly **89.5 million orders** in Q4 2025, serving about **26 million customers** in 2025 [15]. Real-world grocery execution is a proven, large market.

## Business model

**Consumer subscription, one price per household, not per person.** Per-household pricing reinforces the shared-hub model and removes a barrier to whole-family adoption - nobody is counting seats.

Price against the established band. Existing family-org subscriptions run roughly **$40 to $90 per year**: Cozi Gold at $39, Maple+ at $40, Skylight Plus around $79, Hearth around $86, with hardware hubs also charging $180 to $700 upfront [8]. There is headroom above that band: the average US household already spends about **$219 a month** on subscriptions and underestimates that spend by about 2.5 times [9]. Butler's job is to be obviously worth its line on that list.

The category already pays. Skylight reports about **9.3 million connected users**, **99 percent** year-over-year revenue growth, roughly **$75 million** in revenue (2022), and **$50 million** raised in debt while bootstrapped [10]. Cozi has cited **20 million-plus registered users** [11]. The question is not whether families pay for this; it is who becomes the hub.

Future optionality, not a v1 bet: transaction commissions on grocery volume could become a second, aligned revenue line once volume exists. Keep it clearly secondary so it never corrupts trust.

## What winning looks like

**North star: weekly active households.** Not users - households. It measures the multiplayer habit, which is the whole game.

**Proposed v1 target:** 50 percent of onboarded households still weekly-active at month 3. The bar to beat: across a large sample of apps, the average app loses about **77 percent** of its daily active users within three days and more than **95 percent** by day 90 [19]. That figure is DAU decay measured on Android in 2015, not install-cohort retention, so we use it directionally - most engagement is gone by roughly three months unless something keeps pulling people back. Holding half of households weekly-active at month 3 would put Butler far off that curve.

Guardrails alongside the north star:

- **Fairness guardrail:** the distribution of completed chores across household members trending toward balance (the top contributor's share falling over time). This proves Butler solves the real pain, not just tracks it.
- **Execution guardrail:** grocery orders placed through the hub per active household per month, target at least one - the monthly wow, actually happening.
- **Retention guardrail:** month-3 weekly-active household retention (the north-star target above), plus passive glances per day trending up.

## What we are NOT building in v1

The v1 scope is a hard line. Butler v1 is the shared hub running exactly three things:

1. Chore mapping and fair assignment.
2. The household model (rooms, then people, then chores).
3. Exactly one demoable grocery flow.

Multiplayer - the hub plus tap-to-claim - is non-negotiable on day one. Everything below is explicitly deferred, and saying so is the point:

- Calendar integration (arrives at v1.1, and it is what completes the retention thesis).
- Meal planning and budgeting.
- A required mobile companion app (optional and organizer-first if it ships at all).
- Multiple grocery stores at once (v1 is one connector).
- Hands-off ordering (v1 keeps a human on the final tap).
- Butler-made hardware.
- Full parental controls.

If a feature is not on the three-item list, it is not in v1.

## How we're building this

Butler is a tech experiment and a build-in-public blog series. We ship in the open, one capability at a time, and write up what we learn as we go. The reasons are practical: building in public creates accountability, invites the partner and user conversations we need (especially on grocery), and forces each capability to stand on its own before the next one starts. The knowledge base you are reading is part of that - see the [Overview](00-overview.md) for how it grows.

## Risks and how we de-risk them

- **Grocery and partnership dependency.** HEB has no public consumer API [16], and official access may need a real business relationship on a timeline we do not fully control. De-risk: the [Store Connector](90-glossary.md#store-connector) abstraction lets v1 ship against an aggregator or an assisted flow and swap in official access later without changing the product. Build the demo before the official integration lands.
- **Alexa platform dependency.** Voice-in leans on Amazon's terms and API surface, which can change. De-risk: keep voice scoped to capture, not checkout (conversion there is thin anyway [18]), and keep the hub fully usable without it.
- **Tap-to-claim security trade-off.** No passwords for participants is what makes adoption ambient, but it means the hub trusts whoever is standing at it. De-risk: keep real credentials, billing, teardown, and large purchases behind the organizer's auth, so a no-password tap can never do irreversible or costly things.
- **Retention and the novelty cliff.** Chore apps are widely observed to lose families once novelty fades, consistent with the general day-90 engagement collapse [19]. De-risk: make the daily habit a glance (a pull) rather than a chore (a push), and land calendar at v1.1 so the wall is worth checking every morning. Watch month-3 weekly-active households and passive glances per day as the early warning.

## Sources

1. Oxfam, "Time to Care" (2020). https://www.oxfam.org/en/not-all-gaps-are-created-equal-true-value-care-work
2. Weeks and Ruppanner, *Journal of Marriage and Family* (2024), via ScienceDaily. https://www.sciencedaily.com/releases/2024/12/241212150327.htm
3. Weeks, Kowalewska and Ruppanner, *Socius* (2025). https://journals.sagepub.com/doi/10.1177/23780231251384527
4. BLS American Time Use Survey, 2024 reference year (published June 2025). https://www.bls.gov/news.release/atus.nr0.htm
5. OECD, "Gender gaps in paid and unpaid work persist." https://www.oecd.org/en/publications/gender-gaps-in-paid-and-unpaid-work-persist_25a6c5dc-en/full-report.html
6. US families with own children under 18, 2025, Census/CPS via FRED (TTLFMCU). https://fred.stlouisfed.org/series/TTLFMCU
7. US total and family households, 2025, Census/CPS via FRED (TTLHH / TTLFHH). https://fred.stlouisfed.org/series/TTLHH
8. Family-org subscription pricing, primary company pages (2026): Cozi, Maple, Skylight, Hearth.
9. C+R Research, subscription spending survey (2024). https://www.crresearch.com/blog/subscription-service-statistics-and-costs/
10. Skylight financing PR via Nasdaq/StockTitan (April 2025) and Forbes (2022). https://www.stocktitan.net/news/OBDC/skylight-fuels-family-first-innovation-with-50-million-of-financing-k0myawg0sghn.html and https://www.forbes.com/sites/amyfeldman/2022/12/20/how-a-former-vc-built-a-consumer-tech-company-to-75-million-revenue-with-no-investors/
11. Cozi, "20 million members" milestone (2017). https://www.cozi.com/blog/20-million-members/
12. Census ACS, tablets in households with children (2021). https://www.census.gov/library/stories/2023/04/tablets-more-common-in-households-with-children.html
13. Edison Research, Infinite Dial 2025. https://www.edisonresearch.com/the-infinite-dial-2025/
14. Brick Meets Click / Mercatus, US e-grocery December 2025. https://www.brickmeetsclick.com/presses/u-s-egrocery-sales-surge-32-yoy-to-a-record-12-7-billion-in-december-2025
15. CNBC on Instacart Q4 2025 earnings (2026). https://www.cnbc.com/2026/02/12/instacart-cart-q4-2025-earnings.html
16. HEB integration surfaces: Orderful and an unofficial OSS project. https://www.orderful.com/network/heb-grocery and https://github.com/mgwalkerjr95/texas-grocery-mcp
17. H-E-B scale and revenue estimate (2024), Wikipedia. https://en.wikipedia.org/wiki/H-E-B
18. Capital One Shopping, voice-shopping statistics. https://capitaloneshopping.com/research/voice-shopping-statistics/
19. Quettra data via Andrew Chen, mobile DAU decay. https://andrewchen.com/new-data-shows-why-losing-80-of-your-mobile-users-is-normal-and-that-the-best-apps-do-much-better/

## Related

- [Overview](00-overview.md) - what Butler is and how this knowledge base is organized.
- [Glossary](90-glossary.md) - every term used above, defined once.
