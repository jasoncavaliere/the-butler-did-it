# Product Vision — Household Concierge (working title)

*A shared family operating system that turns the chaos of running a home into something calm, fair, and automatic.*

---

## 1. The one-line vision

**We're building the operating system for the home — starting with a shared-tablet hub that fairly divides the household's work, models the home itself, and reaches into the real world to get things done (like ordering groceries).**

Not "another app on mom's phone." A **shared surface the whole family gathers around**, the way a fridge door or a kitchen whiteboard is today — but alive, fair, and connected.

---

## 2. The problem we're solving

Running a household is invisible, unfair, and unautomated:

- **The mental load is concentrated on one person.** One member (usually a parent) holds the entire to-do list in their head, nags everyone else, and burns out. This is the emotional core of the problem.
- **Work is invisible and feels unfair.** No one agrees on who does how much, because no one is counting. Resentment compounds.
- **Home logistics are fragmented.** Chores live in someone's head, the grocery list on the fridge, reminders in texts, the calendar somewhere else. Nothing connects.

The pain is real, recurring, and emotionally charged — which is exactly what makes households willing to pay for relief.

---

## 3. Who we build for first

**Overwhelmed households and parents** — families actively coordinating chores, kids, appointments, and home logistics.

Within that, our true first user is **the household organizer** (the person carrying the mental load), because they feel the pain most acutely and will champion adoption. But the product only *works* if the whole family participates — which is why the shared hub matters (see §5).

> **PM note — narrow before you broaden.** Resist the urge to serve "everyone with a home." Win the messy, logistics-heavy family household completely before expanding to roommates, single professionals, or eldercare. A vision is more defensible when it names exactly who it's *not* for yet.

---

## 4. The wedge and the expansion story

A defensible vision leads with **one** thing it's the best in the world at, then expands. Ours:

**Wedge — Chore mapping & fair assignment.** Lead here. It's the most emotionally resonant entry point ("stop the nagging, make it fair"), it creates a weekly habit loop, and it gives us a reason to be on the family's shared screen every day.

*Known risk:* chore apps are notorious for high churn — novelty wears off, and the family drifts back to nagging. Our answer is that chores are the **hook**, not the **whole product**. The hub, the household model, and grocery integration are what make it sticky enough to stay.

**Expansion 1 — Household model (rooms / people / chores).** The structured "digital twin" of the home. Chores attach to rooms, then to people. This is the foundational data layer everything else compounds on.

**Expansion 2 — Real-world execution (grocery: Alexa → cart).** Voice-captured shopping lists flow straight into a grocery cart. This is the "wow" that proves we don't just *track* work — we *do* it. Generic by design, targeting **HEB** first.

The sequencing story: **Chores get us in the door → the household model makes us the system of record → real-world execution makes us indispensable.**

---

## 5. The product concept: a shared hub, not a phone app

**Decision: the primary surface is a standalone app on a shared tablet, mounted in a common space (kitchen, entryway) — the family's communication and coordination hub.**

This is the single most strategically important choice in the vision, because it solves the #1 killer of household products: **multiplayer adoption.**

Most family apps die because they require *every* member to download, log in, and open an app they don't care about. Teens and reluctant spouses never do. By making the hub a **shared, always-on surface**, participation becomes ambient — you glance at it, tap your name, see what's yours — with no install and no login friction for participants.

> **PM note — this reframes the whole company.** You're no longer competing with to-do apps; you're competing for a *physical spot in the home* and for being the family's default coordination surface. That's a bigger, more defensible position — and it should inform hardware/display strategy, offline behavior, and always-on UX from day one.

**Open design questions this raises (worth resolving early):**
- Individual mobile companion vs. hub-only for v1? (Recommend: hub-first, lightweight notifications to phones via existing channels — SMS/Alexa — so non-organizers never *need* the app.)
- Identity/auth on a shared device (tap-to-claim profiles, no passwords).
- What happens when the family isn't standing at the tablet? (Reminders must reach people where they are.)

---

## 6. Architecture principle: modular by design

You want the functionality modular — this is a strength, and it should be an explicit design tenet, not just an implementation detail.

- **The household model is the shared spine.** Rooms, people, and chores are the core entities every module reads from and writes to. Build this cleanly and everything else plugs in.
- **Each capability is a module** (chores, groceries, calendar, etc.) that composes on top of the spine.
- **The grocery integration is its own abstraction layer** — a generic "store connector" interface, with HEB as the first implementation. This keeps the promise of "plug into any grocery store" architecturally honest rather than aspirational.

This modularity is also a **go-to-market asset**: you can launch, message, and price capabilities independently, and add stores/integrations without re-architecting.

---

## 7. Where the moat is

Your stated edge is **real-world execution / integrations** — the ability to actually *do* things (order groceries), not just remind. That's the right primary moat: it's hard to build, hard to copy, and it's the difference between a novelty and a utility.

Layered underneath, two compounding moats emerge naturally:

1. **The household data model.** The longer a family uses it, the richer the twin of their home becomes (rooms, routines, who does what, preferences). That context is sticky and hard to rebuild elsewhere.
2. **The physical + habitual position.** Being the always-on hub in the kitchen is a footprint competitors can't easily dislodge once you're there.

> **PM note — sequence the moat.** Execution/integrations are the *demonstrable* moat that wins early trust and press. The data model is the *durable* moat that keeps you won. Say both explicitly in any investor conversation.

---

## 8. The riskiest bet: real-world grocery integration

**Approach: pursue official partnerships / APIs** (HEB first; then Instacart, Kroger, etc.).

This is the durable, defensible path and the right long-term call. Be clear-eyed about the tradeoffs so the vision stays credible:

- **Reality check:** HEB has no public consumer API today. Official access may require a real business relationship, which takes time you don't control.
- **Chicken-and-egg:** partners want traction; traction (partly) wants the integration. Plan for how you demo/prove value *before* the official integration lands.
- **Recommended hedge:** treat the "store connector" as an abstraction layer (see §6) so you can start against whatever's available (an aggregator like Instacart already spans many stores) and swap in official HEB access when it lands — without changing the product experience.
- **Voice piece:** the Alexa shopping-list integration has its own platform dependency (Amazon's terms and API surface). Validate feasibility early; don't assume.

This is the part of the vision most worth pressure-testing with real technical/legal discovery before committing publicly.

---

## 9. Business model

**Consumer subscription** — flat monthly/annual fee to the household.

Why it fits: it's simple, it aligns incentives (we win by making family life better, not by pushing transactions), and household pain is recurring enough to justify recurring payment.

> **PM notes to strengthen it:**
> - **One price per household, not per person.** Reinforces the shared-hub model and removes a barrier to whole-family adoption.
> - **Watch the value-justification bar.** Subscriptions live or die on *perceived ongoing value*. Chores alone won't clear the bar long-term; the grocery/execution layer is likely what makes the monthly fee feel obviously worth it. This is another reason execution can't be a "someday" feature.
> - **Future optionality (don't build yet):** transaction commissions on grocery orders could become a second, aligned revenue stream once volume exists — but keep it clearly secondary so it never corrupts trust.

---

## 10. Why now

- **AI makes fair, automatic assignment and natural-language capture actually work** ("add milk" by voice → structured list → cart) in a way that felt clunky even a couple years ago.
- **Ambient/shared home screens are normalized** — families are comfortable with an always-on kitchen display.
- **Real-world commerce APIs are maturing**, making "the assistant that actually does things" newly feasible.

---

## 11. What "winning" looks like (proposed north-star + guardrails)

- **North star:** weekly active *households* (not users) — measures the multiplayer habit, which is the whole ballgame.
- **Fairness signal:** distribution of completed chores across household members trending toward balance (proves we're solving the *real* pain, not just tracking).
- **Execution signal:** grocery orders placed through the hub per household per month (proves the moat is working).
- **Retention signal:** household retention past the 3-month "novelty cliff" that kills chore apps.

---

## 12. Open strategic questions to resolve next

These are the decisions that will most shape whether the vision holds up. Recommend tackling in this order:

1. **Grocery feasibility (highest risk).** Can we get HEB / an aggregator to a working, demoable integration on an acceptable timeline? Do discovery *before* over-committing publicly.
2. **Hub hardware & offline strategy.** Own hardware, BYO-tablet, or both? What's the experience when disconnected?
3. **Participant identity & notifications.** How do non-organizers interact with zero friction, and how do reminders reach them off the hub?
4. **The retention mechanism.** Beyond novelty, what specifically brings the family back to the hub every day? (Likely: it becomes the single source of truth for the week — chores + calendar + list all in one glanceable place.)
5. **Scope of v1.** Recommend: chores + household model + a *demoable* grocery flow (even if partnership-limited), all on the shared hub. Resist adding more.

---

*Prepared as a first-pass vision to iterate on. Every recommendation here is a starting position, not a final answer — the point is to give you a defensible spine you can pressure-test with users, partners, and investors.*
