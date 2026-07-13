# Build Brief — Butler Knowledge Base (seed)

This brief is the source of truth for the first build of the Butler knowledge base. The
`knowledge-base-writer` authors from this brief plus the raw source at
`household-concierge-vision-v0.md`. Everything below was settled interactively with the product owner.

Product working name: **Butler** (repo: `the-butler-did-it`). Tagline concept: a shared family
operating system for the home. Also framed as a **tech experiment and a #buildinpublic blog series** —
built in the open, one capability at a time.

---

## 1. Information architecture (approved)

- **Graph shape:** hub-and-spoke. The Product Vision is the hub; strategy and architecture articles
  are spokes that grow around it over time.
- **Category set (fixed, 5):** `Start Here` | `Product & Strategy` | `Architecture` | `Operations` |
  `Reference`.
- **Seed articles to author now:**
  - `docs/00-overview.md` (Start Here) - what Butler is, what this KB is, how humans and agents
    navigate and grow it. Include the "built in public, one capability at a time" framing.
  - `docs/10-product-vision.md` (Product & Strategy) - THE seed article. The full, world-class vision,
    quantified with the fact pack in section 4. Keep it as ONE article (it is one concept); note that
    sections can split into their own `1x` articles as they grow.
  - `docs/90-glossary.md` (Reference) - shared vocabulary. Minimum terms: Butler, the Hub, Household
    Model, Household Organizer, Participant, Tap-to-claim, Chore Mapping / Fair Assignment, Store
    Connector, Assisted Cart, Novelty Cliff, North Star, BYO-tablet.
  - `README.md` - index / knowledge-graph map + by-role entry table (roles: New to Butler; Product /
    leadership; Engineer / agent; Investor / partner).
  - `HOW-TO-MAINTAIN.md` - how an agent keeps the graph clean as it grows (every write is a graph
    edit; reserved numeric ranges; Living vs Record; sources live in `intake/`).
- **Reserved numeric ranges (define in HOW-TO-MAINTAIN, do not fill yet):** `10-19` Product &
  Strategy, `20-39` Architecture, `40-59` Operations, `90+` Reference.
- **Edges (bidirectional):** overview <-> vision, overview <-> glossary, vision <-> glossary. No orphans.
- **Provenance:** the raw source vision and this brief live in `intake/`. Keep them; future agents need
  the sources. `docs/` is canonical; `intake/` is source material.

## 2. The five locked decisions (fold these into the vision, replacing the source's open questions)

1. **v1 scope (hard line):** the shared hub running (a) chore mapping & fair assignment, (b) the
   household model (rooms -> people -> chores), and (c) exactly one demoable grocery flow. Nothing
   else. Multiplayer (hub + tap-to-claim) is non-negotiable on day one. Calendar, meal planning,
   budgeting, mobile companion, multiple stores, own hardware are all explicitly deferred.
2. **Hub hardware & offline:** BYO-tablet for v1 (any Android tablet / iPad the family already owns,
   ~$100-150), delivered as a web app / installable PWA. Offline-tolerant: last-known week stays
   glanceable and readable with no network; writes queue and sync on reconnect. Own hardware
   procurement is an explicit later maturation, door left open, not a v1 bet.
3. **Grocery integration path:** destination is official partnerships / APIs (HEB first), but ship v1
   against whatever is available (aggregator or an assisted/semi-manual flow) behind a generic
   `StoreConnector` abstraction - the product experience never changes, only the connector swaps.
   Ladder: v1 = one connector, assisted cart (human confirms the final tap), HEB-first, Alexa
   voice-in -> maturing = hands-off ordering on trusted connectors -> mature = the household selects
   its own set of store integrations from a catalog of connectors and Butler routes the order. The
   store-connector is therefore a user-facing product surface at maturity, not just internal plumbing.
4. **Retention mechanism:** the hub becomes the family's single glanceable source of truth for the
   week - the daily habit is "glance at what's happening today" (a pull), not "go do a chore" (a push
   that churns). Grocery execution is the recurring monthly wow that re-earns the subscription. Be
   honest: v1 proves the loop; the durable retention curve fully kicks in at v1.1 when calendar
   integration joins the glance. Retention signal = households still weekly-active past month 3, plus
   passive glances/day trending up.
5. **Identity & off-hub notifications:** on the hub, tap-to-claim profiles, no passwords for
   participants; one household-owner account holds real credentials + billing; sensitive actions
   (billing, teardown, large purchases) sit behind the owner's auth. Off the hub, reach people on
   channels they already have (SMS / Alexa first) so a teen or reluctant spouse never installs
   anything; a mobile companion app is optional and organizer-first, never required for participation.
   Kids get lightweight tap-to-claim profiles with a simple parent/child flag (age-appropriate chores;
   sensitive actions behind the owner); full parental controls deferred past v1.

## 3. Quality bar (the vision article must hit all ten)

1. One memorable line a stranger can repeat after one read.
2. A visceral, QUANTIFIED problem (use the fact pack).
3. A named beachhead - who it is for AND who it is not for yet.
4. A single wedge (chore mapping & fair assignment) -> sequenced expansion (household model ->
   real-world execution).
5. A differentiated, sequenced moat (execution is the demonstrable moat; the data model is the durable
   moat; the physical/habitual hub position is the footprint).
6. "Why now" - backed by data (ambient screens normalized, online grocery surging, AI makes fair
   assignment + natural-language capture work).
7. A business model that aligns incentives: consumer subscription, one price per household (not per
   person), priced against the $39-$86/yr band.
8. Quantified success - a north star with an actual target proposal, plus fairness / execution /
   retention guardrail metrics.
9. An explicit non-goals section (its own section, not a buried aside).
10. A narrative spine - open the vision with a short "day in the life" scene at the hub the reader can
    picture.

Also add a short section on the build-in-public / tech-experiment nature ("How we're building this:
in the open, one capability at a time"), and a "Risks and how we de-risk them" section that treats the
grocery/partnership dependency, the Alexa platform dependency, tap-to-claim's security trade-off, and
the retention/novelty risk clear-eyed.

## 4. Quantification fact pack (VERIFIED - cite these; obey the honesty flags)

Every figure below came from a research pass with source URLs. Cite the source and year inline or in a
"Sources" section at the foot of the vision article. Where a range is given, USE THE RANGE - do not
collapse it to a false-precision single number. DO NOT cite anything marked "folklore / do not cite."

**The problem - mental load and unfairness (the emotional core):**
- Unpaid care work done by women and girls is worth **at least $10.8 trillion a year** globally.
  Oxfam, "Time to Care" (2020), https://www.oxfam.org/en/not-all-gaps-are-created-equal-true-value-care-work.
  Flag: advocacy NGO estimate valued at minimum wage (a deliberately conservative floor), women/girls
  only. Present as "at least" / "conservatively."
- Mothers manage about **71% of household mental-load (cognitive) tasks; fathers about 45%** (rated
  per-domain, so they do not sum to 100%). Weeks & Ruppanner, *Journal of Marriage and Family* (2024),
  https://www.sciencedaily.com/releases/2024/12/241212150327.htm. Flag: peer-reviewed, ~3,000 US
  parents, self-report. This is the citable "mental load" stat - prefer it over unattributed numbers.
- Corroborating (2025): mothers report **67% more household-management tasks than fathers (13.72 vs
  8.2 on average)**, and higher income cuts women's physical housework but not their cognitive load.
  Weeks, Kowalewska & Ruppanner, *Socius* (2025), https://journals.sagepub.com/doi/10.1177/23780231251384527.
  Flag: overlapping authors with the 2024 study - treat as related corroboration, not independent.
- Time gap: US women average **2.8 hours/day** on household activities vs men **2.1**; childcare of a
  child under 6, women **1.2 hrs/day** vs men **~0.6**. BLS American Time Use Survey, 2024 reference
  year (pub. June 2025), https://www.bls.gov/news.release/atus.nr0.htm. Flag: government diary survey,
  high reliability; verify exact digits against the live release before publishing.
- OECD: across member countries women do nearly **twice as much unpaid work** as men.
  https://www.oecd.org/en/publications/gender-gaps-in-paid-and-unpaid-work-persist_25a6c5dc-en/full-report.html.

**Market size and willingness to pay:**
- **33.6 million US families with own children under 18 (2025)** - the tightest count of the beachhead.
  Census/CPS via FRED (TTLFMCU), https://fred.stlouisfed.org/series/TTLFMCU.
- **134.8M total US households; 86.0M family households (2025)** - the broader expansion market.
  Census/CPS via FRED (TTLHH / TTLFHH).
- Existing family-org subscription prices (the WTP band): **Cozi Gold $39/yr, Maple+ $40/yr, Skylight
  Plus ~$79/yr, Hearth ~$86.40/yr** - so roughly **$40-$90/year** is the established band; hardware
  hubs (Skylight, Hearth) also charge $180-$700 upfront. Primary company pages (2026). Flag: confirm
  the current Skylight subscription price (sources disagree $50 vs $79/yr) before quoting a point value.
- Average US household spends **~$219/month (~$2,600/yr) on subscriptions** and underestimates that
  spend by ~2.5x. C+R Research (2024), https://www.crresearch.com/blog/subscription-service-statistics-and-costs/.
  Flag: all-category consumer survey, not family-org-specific; use for pricing-headroom context only.

**Proof the category has real traction (de-risks "will anyone pay?"):**
- **Skylight: ~9.3M connected users, 99% YoY revenue growth, $50M raised (debt), ~$75M revenue in
  2022, bootstrapped.** Skylight PR via Nasdaq/StockTitan (Apr 2025) + Forbes (2022),
  https://www.stocktitan.net/news/OBDC/skylight-fuels-family-first-innovation-with-50-million-of-financing-k0myawg0sghn.html,
  https://www.forbes.com/sites/amyfeldman/2022/12/20/how-a-former-vc-built-a-consumer-tech-company-to-75-million-revenue-with-no-investors/.
  Flag: company-stated vendor metrics; "users connected" spans Frame + Calendar.
- **Cozi: 20M+ registered users** (milestone 2017, still cited). https://www.cozi.com/blog/20-million-members/.
  Flag: cumulative registrations, ~9 years old - a soft ceiling, not current active users.

**Why now:**
- **64% of US households own a tablet; 80% of households WITH children (vs 57% without).** Census ACS
  (2021), https://www.census.gov/library/stories/2023/04/tablets-more-common-in-households-with-children.html.
  Flag: 2021 is the most recent Census household figure; Pew no longer publishes a tablet number.
- **~35% of Americans 12+ own a smart speaker (~101M people), plateaued ~one-third for four years.**
  Edison Research, Infinite Dial 2025, https://www.edisonresearch.com/the-infinite-dial-2025/.
  Flag: verify the 35%/101M pair against the Edison deck.
- Online grocery is surging: **$12.7B in a single month (Dec 2025), ~19% of US grocery spend that
  month, +32% YoY.** Brick Meets Click / Mercatus, https://www.brickmeetsclick.com/presses/u-s-egrocery-sales-surge-32-yoy-to-a-record-12-7-billion-in-december-2025.
  Flag: December peak month; full-year share runs lower.
- Instacart scale (proof real-world grocery execution is a real market): **~$9.85B GTV and ~89.5M
  orders in Q4 2025; ~26M customers in 2025.** CNBC on Q4 2025 earnings,
  https://www.cnbc.com/2026/02/12/instacart-cart-q4-2025-earnings.html.
  Flag: from earnings coverage (CNBC page 403'd); upgrade to Instacart's SEC 8-K (EDGAR CIK
  0001579091) before publishing.

**The moat is real (execution is hard):**
- **HEB has NO official public consumer-ordering API** - only supplier/EDI surfaces and unofficial
  scrapers exist (an OSS project self-describes as "not affiliated with H-E-B ... unofficial web APIs
  and browser automation"). https://www.orderful.com/network/heb-grocery,
  https://github.com/mgwalkerjr95/texas-grocery-mcp. This is the single best justification for the
  store-connector abstraction and the partnership path.
- **HEB scale:** ~435+ stores, Texas + northern Mexico; revenue estimated **$46.5B-$50B (2024)**;
  privately held so all revenue is trade estimate, not audited. https://en.wikipedia.org/wiki/H-E-B.
- Voice-shopping conversion is thin even with a huge Alexa install base - supports framing **voice as
  capture, not checkout**. Capital One Shopping research, https://capitaloneshopping.com/research/voice-shopping-statistics/.
  Flag: aggregator/self-serve methodology - directional only.

**Retention risk (be honest - the novelty cliff):**
- The strongest VERIFIED anchor: an average app loses **~77% of daily active users by day 3 and >95%
  by day 90** (across all apps). Quettra data via Andrew Chen,
  https://andrewchen.com/new-data-shows-why-losing-80-of-your-mobile-users-is-normal-and-that-the-best-apps-do-much-better/.
  Flag: real methodology (125M+ Android devices) but 2015 and Android-only; it is DAU decay, not
  install-cohort retention. Use it to support "most engagement is gone by ~3 months" generally.
- **FOLKLORE / DO NOT CITE:** the specific "43% abandon a habit app in 30 days / 72% by 90 days /
  3-month novelty cliff for chore apps" figures. No primary source, no methodology - they read as
  unsourced content-marketing. Frame the novelty cliff as a well-observed qualitative pattern backed
  by the general day-90 DAU collapse above; never quote the fake percentages.

## 5. Style and honesty rules
- Plain ASCII prose. No em dashes, curly quotes, ellipsis, or non-breaking spaces (use -, straight
  quotes, ...). The usability scorer hard-fails these.
- Show, do not tell: lead the problem with numbers, not adjectives.
- Preserve the source doc's best strategic ideas (the shared-hub reframe, sequenced moat, one-price-
  per-household) but replace its 12 open questions with the locked decisions in section 2.
- Every quantitative claim carries a source. Prefer a "Sources" section at the foot of the vision
  article with numbered links, referenced inline as [1], [2], ... - or inline links; author's choice,
  but nothing uncited.
- Use ranges where the fact pack gives ranges. Never manufacture false precision.
- Keep the vision to one focused, scannable article - short paragraphs, bullets, tables over walls of
  text.
