---
type: Strategy
title: Pricing Hypothesis and Pilot-to-Paid Offer
description: "Proposed per-household yearly price points inside the vision's $40-90 band, the pilot-to-paid offer, and the willingness-to-pay questions and experiment that test them (a hypothesis, not live pricing)."
tags: [pricing, business model, subscription, per household, pilot, conversion, willingness to pay, go to market]
category: Product & Strategy
lifecycle: Living
owner: agent-managed
related: [10-product-vision, 13-customer-interview-guide, 14-feedback-log-template, 15-pilot-success-criteria, 16-pilot-one-pager]
sources:
  - { id: issue-137, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/137, title: S4 - Pricing hypothesis and pilot-to-paid offer }
  - { id: vision-business-model, resource: 10-product-vision.md#business-model, title: Product Vision - Business model }
  - { id: issue-232, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/232, title: Close the decision-rule gap in the pricing hypothesis }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-15T23:31:41Z }
---

# Pricing Hypothesis and Pilot-to-Paid Offer

> **In one line:** Butler proposes one yearly price per household, $69 as the list price and $49 as a founding price for pilot families who convert, and tests both with a short set of willingness-to-pay questions before anything is charged.

This article was written on **2026-11-14** for [issue #137](https://github.com/jasoncavaliere/the-butler-did-it/issues/137), and it is a **hypothesis, not live pricing**. The numbers are a proposal for the owner to ratify or change in review, and Butler charges no household anything today. Every market figure below comes from the vision's [Business model](10-product-vision.md#business-model) section, where it is sourced, and is not repeated here as a new claim.

## The band we price against

The vision sets the rules this article works inside: Butler is a consumer subscription with **one price per household, not per person** (see [Business model](10-product-vision.md#business-model)).

- **The band:** existing family-organization subscriptions run roughly **$40 to $90 per year**, with Cozi Gold at $39 just under it and Skylight Plus (about $79) and Hearth (about $86) near the top.
- **The hardware gap:** dedicated hardware hubs also charge $180 to $700 upfront, while Butler sells no hardware because the hub runs on a tablet the family already owns.
- **The headroom:** the average US household already spends about $219 a month on subscriptions, so Butler has to be obviously worth its line on that list.

All of these points are quoted from the vision with its original sources, and this article adds no new market data.

## Price points

Each point is a **yearly price per household**, and all three are hypotheses. The proposal is annual pricing only; a monthly plan remains an open question (see [What this does not decide](#what-this-does-not-decide)).

| Price point | Per household per year | Position in the $40-90 band | Rationale |
| --- | --- | --- | --- |
| **Founding price** (pilot conversion) | **$49** | Low end, just above Cozi Gold ($39) and Maple+ ($40) | The [Business model](10-product-vision.md#business-model) prices against the band, so a first commitment should sit near its floor. v1 runs only three things ([What we are NOT building in v1](10-product-vision.md#what-we-are-not-building-in-v1)), and the full retention curve only arrives with calendar at v1.1 ([The retention thesis](10-product-vision.md#the-retention-thesis)). Early families pay less because they get less, and because they help shape it. |
| **List price** | **$69** | Mid-band, below Skylight Plus (about $79) and Hearth (about $86) | One price covers the whole household, so nobody counts seats ([Business model](10-product-vision.md#business-model)). The hub is a tablet the family already owns, with no hardware to buy from us ([The product: a shared hub, not a phone app](10-product-vision.md#the-product-a-shared-hub-not-a-phone-app)). The family gets the chore wedge plus grocery ([The wedge and the expansion story](10-product-vision.md#the-wedge-and-the-expansion-story)), and grocery is the monthly wow that re-earns the subscription ([The retention thesis](10-product-vision.md#the-retention-thesis)). At $69 a year, that is under $6 a month. |
| **Ceiling test** (questions only) | **$89** | Top of the band, near Hearth (about $86) | The vision notes headroom above the band, with about $219 a month already spent on subscriptions ([Business model](10-product-vision.md#business-model)). The moat builds in order: grocery execution first, then the household data model ([Where the moat is, in sequence](10-product-vision.md#where-the-moat-is-in-sequence)). $89 may be earned once both are real, so for now it is asked about, never offered. |

## The pilot-to-paid offer

The pilot comes first, and the paid offer arrives at its end. The pilot terms themselves belong to the [Pilot One-Pager](16-pilot-one-pager.md), so this section only states how a pilot family is asked to pay.

- **The pilot:** six weeks with a weekly 10-minute check-in, free, with no payment card collected up front, as the [Pilot One-Pager](16-pilot-one-pager.md) sets.
- **Who is asked:** the [Household Organizer](90-glossary.md#household-organizer), who holds billing for the household; participants are never asked to pay.
- **When:** the offer is introduced at the week-5 check-in and formally made at pilot exit, at the end of week 6.
- **The offer:** the founding price of **$49 a year for the first 12 months**, with the $69 list price shown as the anchor, after which the household moves to the list price with notice first.
- **The decision window:** the organizer has **14 days** to decide (a hypothesis), and the hub keeps working during that window.
- **What counts as converting:** a real commitment, meaning a pre-payment or a signed commitment to pay, because a friendly "sounds good" does not count.
- **How money is collected:** this is an open question for the owner, since v1 has no billing feature and this article does not promise one.
- **If the household does not convert:** the organizer can tear the household down, which deletes all of its data ([#124](https://github.com/jasoncavaliere/the-butler-did-it/issues/124)).

## Willingness-to-pay questions

These ten questions are asked in the same words every time, so answers can be compared. The [Customer Interview Guide](13-customer-interview-guide.md) should draw its pricing questions from this list.

1. At what yearly price for your household would Butler be so cheap that you would doubt it works?
2. At what yearly price would Butler feel like a bargain?
3. At what yearly price would Butler start to feel expensive, though you would still consider it?
4. At what yearly price would Butler be too expensive to consider?
5. Would your household pay $89 a year for Butler, and if not, would it pay $69 or, failing that, $49?
6. What does your household pay today for family organizing apps or hubs, if anything?
7. Which part would you miss most if it went away: chores and fairness, the daily glance at the hub, or grocery?
8. Who in your household would decide to pay for Butler, and who would actually pay?
9. Would you rather pay one price for the whole household or a smaller price for each person?
10. Would you run the hub on a tablet you already own, or would you buy one for it?

Questions 1 to 4 form a Van Westendorp price-sensitivity set, and question 5 is a Gabor-Granger ladder that steps down from the ceiling test through the list price to the founding price.

## Experiment design

The experiment moves from what people say to what they actually do, and each stage reuses the questions above by number.

| Stage | When | What we ask or offer | What we record |
| --- | --- | --- | --- |
| **A. Stated, after the demo** | Right after a demo, before any pilot | Q1 to Q10 | Every answer, logged in the [Feedback Log](14-feedback-log-template.md) |
| **B. Stated, after use** | The pilot's week-5 check-in | Q1 to Q5 and Q7 | Every answer, compared with the same household's Stage A answers |
| **C. Revealed, at pilot exit** | End of week 6 | The pilot-to-paid offer at the $49 founding price | Accept, decline, or no answer within the 14-day window |
| **D. Revealed, at renewal** | Month 12 after a household converts | Renewal at the $69 list price, with notice first | Renew, cancel, or no answer by the renewal date |

### Measures

- The Van Westendorp range from Q1 to Q4, meaning the span between "too cheap" and "too expensive" that most households would accept.
- The share of yes answers at each rung of the Q5 ladder ($89, then $69, then $49), compared between Stage A and Stage B.
- The number of households that accept the offer, and that count as a percentage of the households offered.
- The share of converted households that renew at $69 when their founding year ends.

Stage C only ever offers $49, so it shows whether households will pay the founding price. Until Stage D runs, the case for $69 rests on stated answers from Stages A and B.

Pilot cohorts are small, so every measure is directional only and none of them is a statistically significant result.

### Decision rules

These thresholds are hypotheses, written down before the data arrives so the result cannot quietly move them.

- **Keep $69 as the list hypothesis:** at least 40 percent of offered households accept $49, and the Stage B acceptable range includes $69. This keeps $69 on stated evidence only, and Stage D renewals confirm or reject it.
- **Test $59 as list:** at least 40 percent of offered households accept $49, but the Stage B acceptable range excludes $69. The next cohort is offered a $59 list price: the $49 founding offer is unchanged, and the step-up after 12 months is to $59 instead of $69. Strong acceptance at $49 with $69 out of range puts the ceiling between the two, so $59 tests the midpoint.
- **Change course on value:** fewer than 20 percent accept, which suggests the problem is what Butler does rather than what it costs, so improve the product before testing a lower price.
- **Test $49 as list:** any acceptance rate in between. The next cohort is offered $49 with no step-up to $69 after 12 months. The only change is the dropped step-up, so a higher acceptance rate shows the later $69 was holding households back.
- **Drop $69 as list:** fewer than half of converted households renew at $69 in Stage D, in which case $49 becomes the list price for everyone.
- **Revisit $89 later:** the ceiling is only examined again after calendar ships in the v1.1 release.

## What this does not decide

- It does not set live pricing; the owner ratifies or edits these numbers in review.
- It does not build billing, payments, or subscriptions, and v1 includes none of them.
- It does not write the [Pilot One-Pager](16-pilot-one-pager.md), the [Customer Interview Guide](13-customer-interview-guide.md) and [Feedback Log Template](14-feedback-log-template.md), or the [Pilot Success Criteria](15-pilot-success-criteria.md) and week-4 go/no-go.
- It does not price a monthly plan, grocery commissions, or a hardware bundle, which all remain open questions for later.
- It does not change the vision's business model; it only proposes specific numbers inside it.

## Sources

1. [Issue #137 - S4 pricing hypothesis and pilot-to-paid offer](https://github.com/jasoncavaliere/the-butler-did-it/issues/137)
2. [Product Vision - Business model](10-product-vision.md#business-model), which cites the price band, the hardware hub prices, and the subscription spend.
3. [Issue #136 - S3 pilot one-pager](https://github.com/jasoncavaliere/the-butler-did-it/issues/136), for the 6-week pilot and the weekly 10-minute check-in.
4. [Issue #232 - close the decision-rule gap in the pricing hypothesis](https://github.com/jasoncavaliere/the-butler-did-it/issues/232), for the $59 midpoint rule.

## Related

- [Product Vision](10-product-vision.md) - the business model these price points sit inside, and the scope and retention story behind each rationale.
- [Customer Interview Guide](13-customer-interview-guide.md) - where the willingness-to-pay questions are asked after a demo.
- [Feedback Log Template](14-feedback-log-template.md) - where every Stage A answer is recorded.
- [Pilot Success Criteria](15-pilot-success-criteria.md) - the week-4 go/no-go, decided at the week-5 check-in before the offer is introduced.
- [Pilot One-Pager](16-pilot-one-pager.md) - the pilot terms this offer follows, as families read them.
