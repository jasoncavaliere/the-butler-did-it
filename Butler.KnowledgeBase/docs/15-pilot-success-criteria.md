---
type: Strategy
title: Pilot Success Criteria and Week-4 Go/No-Go
description: "Four pilot metrics read from the organizer Insights screen at week 4 (weekly active households, top contributor's share, carts confirmed, distinct participants), each with a hypothesis threshold for build more, change course, or stop, derived from the Product Vision's month-3 target."
tags: [pilot, success criteria, go no-go, north star, weekly active households, fairness, insights, retention]
category: Product & Strategy
lifecycle: Living
owner: agent-managed
related: [10-product-vision, 12-pricing-hypothesis, 13-customer-interview-guide]
sources:
  - { id: issue-140, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/140, title: S7 - Pilot success criteria and go/no-go signals }
  - { id: vision-winning, resource: 10-product-vision.md#what-winning-looks-like, title: Product Vision - What winning looks like }
  - { id: issue-123, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/123, title: V2 - Organizer insights screen }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-14T17:11:50Z }
---

# Pilot Success Criteria and Week-4 Go/No-Go

> **In one line:** At the end of pilot week 4, read four numbers from the organizer Insights screen, compare each with a threshold written down in advance, and decide whether to build more, change course, or stop.

This article was written on **2026-11-14** for [issue #140](https://github.com/jasoncavaliere/the-butler-did-it/issues/140), and its thresholds are a **hypothesis, not a ratified decision**, which the owner ratifies or changes in review. Each threshold is derived from the [North Star](90-glossary.md#north-star) target and guardrails in the vision's [What winning looks like](10-product-vision.md#what-winning-looks-like) section, and this article adds no new market data.

## When and how to read the numbers

The pilot is six weeks with a weekly 10-minute check-in, which is what the pilot one-pager ([#136](https://github.com/jasoncavaliere/the-butler-did-it/issues/136)) sets. That one-pager is still open, so the pilot shape may change.

- **Pilot week 1** is the first full Monday-to-Sunday week, in UTC, after a household is onboarded. The Insights buckets are UTC ISO weeks, so the two line up.
- **When to read:** as soon as pilot week 4 ends, and decide the go/no-go from that reading, one check-in before the pilot-to-paid offer at the week-5 check-in (see [The pilot-to-paid offer](12-pricing-hypothesis.md#the-pilot-to-paid-offer)).
- **On the screen:** the Insights screen always shows 8 weeks, and its last bar is the current, partial week. Read during week 5, pilot week 4 is the bar just before it.
- **Through the API:** call `GET /households/{householdId}/insights?weeks=5` during pilot week 5 and drop the last entry. The four entries left are pilot weeks 1 to 4, oldest first.
- **Who can read it:** only the [Household Organizer](90-glossary.md#household-organizer) can call it, and it accepts from 1 to 52 weeks.
- **One household at a time:** Insights reports one household, so add up the cohort by hand. A cohort-level roll-up would be a code change and is out of scope here.

Three facts about the series shape every row below.

- **Organizers are left out:** the per-person series and the share cover [participants](90-glossary.md#participant) only. A household where only the organizer does chores reads as inactive, and that is deliberate: one adult doing everything is the pain Butler exists to fix.
- **Completions are net:** an undo subtracts the completion it reverses, so a tapped-then-undone chore counts as nothing.
- **Cohorts are small:** every reading is directional only, and none of them is a statistically significant result.

## Week-4 thresholds (a hypothesis)

Every threshold here is written down before any pilot data arrives, so a result cannot quietly move it. The three decisions mean the same thing on every row.

- **Build more:** the signal is healthy, so keep building on the capability it measures.
- **Change course:** the signal is weak, so change the product or the onboarding aimed at it, then read it again.
- **Stop:** the signal says the bet is failing, so stop investing in it. On the carts row, stop means stopping grocery work beyond the one demo flow, not stopping Butler.

N is the number of onboarded households, and A is the number that are active in pilot week 4.

### The scorecard

| Metric | How it is measured (#123 Insights) | Build more (week-4 threshold) | Change course | Stop |
| --- | --- | --- | --- | --- |
| **Weekly active households** (the north star) | Chart "Completions per person"; API `weeks[].completions`. A household is active when its week-4 completions sum to at least 1. Value: A / N. | At least 75 percent | 50 to 74 percent | Below 50 percent |
| **Fairness trend** (top contributor's share) | Chart "Top contributor's share"; API `weeks[].topContributorShare` (0 to 1, read as a percent). Per active household: the mean of weeks 3-4 minus the mean of weeks 1-2, skipping weeks at 0. | The share fell at least 5 points, or is within 5 points of an even split, in at least half of active households | Anything in between | The share rose at least 10 points in more than half of active households |
| **Carts confirmed per month** | Chart "Carts confirmed per month"; API `cartsConfirmedPerMonth[].count`. Sum the months covering weeks 1-4 across active households, then divide by A. | At least 1.0 per active household | 0.5 to 0.99 per active household | Below 0.5 per active household |
| **Distinct participants per week** | Chart "Completions per person"; API `weeks[].completions[]`. A household is multiplayer when at least 2 members, and at least half of its members, have 1 or more net completions in week 4. Value: multiplayer / A. | At least 75 percent | 50 to 74 percent | Below 50 percent |

An even split is 1 divided by the number of members, so 33 percent in a three-member household. A household with no week at a non-zero share in weeks 1-2 has no trend yet and counts toward change course.

Carts are bucketed by UTC calendar month, and pilot weeks 1 to 4 usually span two months, so sum both. With `weeks=5` read early in week 5, the count covers about 28 days, which is close to one month. The 8-week screen can also include carts from before pilot week 1, so use the API for the exact count. Carts come from the simulated store connector, so they measure the confirm habit, not real orders.

### How each threshold is derived

Every derivation starts from the vision's [What winning looks like](10-product-vision.md#what-winning-looks-like), which sets a month-3 target of 50 percent of onboarded households weekly-active, and three guardrails beside it.

- **Weekly active households:** the vision's target is 50 percent weekly-active at month 3. We assume retention only falls after week 4, so a cohort under 50 percent at week 4 cannot reach the target: stop. Since 75 x 2/3 = 50, a 75 percent start can lose a third of its active households by month 3 and still hit 50 percent.
- **Fairness trend:** the vision's fairness guardrail asks for the top contributor's share to fall over time, but gives a direction, not a number. One chore out of about 20 completed in a week moves the share by about 5 points, so 5 points is the smallest fall worth counting. The 20 chores a week is a working assumption, not measured data. "At least half of households" reuses the vision's 50 percent bar. A rise of 10 points means Butler is piling work onto one person, the opposite of the guardrail, so it is a stop.
- **Carts confirmed per month:** the vision's execution guardrail is at least one grocery order per active household per month. That target is used unchanged as the build-more line, and half of that target is the stop line.
- **Distinct participants per week:** the vision calls the multiplayer habit "the whole game" in the north star, and makes multiplayer non-negotiable on day one in [What we are NOT building in v1](10-product-vision.md#what-we-are-not-building-in-v1). The 50 percent bar is applied at the person level, so at least half of a household's members must take part. The household bands of 75 and 50 percent mirror the north star row.

Hub glances per day are not scored, although the vision's retention guardrail names them. The hub reports a glance whenever it is on screen, at most once every 10 minutes, so a hub left on in the kitchen logs glances with nobody looking.

## Combining the four signals

The rows are read together, in this order, and the first rule that matches decides.

1. **Stop** when the north star, the fairness trend, or distinct participants is in its stop band, because each of those says the core multiplayer bet is failing.
2. **Go (build more)** when the north star is in its build-more band and no row is in its stop band.
3. **Change course** in every other case: start with the weakest row, make one change aimed at it, and read all four again after the next four weeks, without moving any threshold.

So a carts row in its stop band never ends the pilot on its own, and the other three rows still decide the go/no-go.

Week 4 comes well before the [Novelty Cliff](90-glossary.md#novelty-cliff), which tracks the general engagement collapse by roughly day 90. So a go at week 4 is a reason to keep going, not proof of month-3 retention.

## What this does not decide

- It does not ratify the thresholds; the owner does that in review.
- It does not set the pilot terms, which belong to the pilot one-pager ([#136](https://github.com/jasoncavaliere/the-butler-did-it/issues/136)).
- It does not set prices or the offer, which are in the [Pricing Hypothesis](12-pricing-hypothesis.md), or the interview questions, which are in the [Customer Interview Guide](13-customer-interview-guide.md).
- It does not change the vision's target or guardrails; it only turns them into week-4 lines.
- It does not build anything, so a cohort-level Insights roll-up remains a possible follow-up rather than part of this article.

## Sources

1. [Issue #140 - S7 pilot success criteria and go/no-go signals](https://github.com/jasoncavaliere/the-butler-did-it/issues/140)
2. [Product Vision - What winning looks like](10-product-vision.md#what-winning-looks-like), for the 50 percent month-3 target and the fairness, execution, and retention guardrails.
3. [Issue #123 - organizer Insights screen](https://github.com/jasoncavaliere/the-butler-did-it/issues/123), for the chart titles, the `GET /households/{householdId}/insights` series, and the rules described in the Insights section of `Butler.API/ARCHITECTURE.md`.
4. [Issue #136 - S3 pilot one-pager](https://github.com/jasoncavaliere/the-butler-did-it/issues/136), for the 6-week pilot and the weekly 10-minute check-in.
5. [Pricing Hypothesis - The pilot-to-paid offer](12-pricing-hypothesis.md#the-pilot-to-paid-offer), for the offer at the week-5 check-in.

## Related

- [Product Vision](10-product-vision.md) - the north star, the month-3 target, and the guardrails every threshold here is derived from.
- [Pricing Hypothesis](12-pricing-hypothesis.md) - the pilot-to-paid offer at the week-5 check-in, one check-in after this go/no-go.
- [Customer Interview Guide](13-customer-interview-guide.md) - the post-demo questions, including the month-3 question these numbers later answer with data.
