---
type: Strategy
title: Pilot One-Pager
description: "The one-page offer for pilot families: what a household gets, what we ask over the six-week pilot, the four numbers we read, how its data is kept, and what happens after (a proposal for the owner to ratify)."
tags: [pilot, one-pager, offer, check-in, privacy, pilot-to-paid, families, go to market]
category: Product & Strategy
lifecycle: Living
owner: agent-managed
related: [10-product-vision, 12-pricing-hypothesis, 15-pilot-success-criteria]
sources:
  - { id: issue-136, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/136, title: S3 - Pilot one-pager }
  - { id: pilot-success-criteria, resource: 15-pilot-success-criteria.md, title: Pilot Success Criteria and Week-4 Go/No-Go }
  - { id: pilot-to-paid-offer, resource: 12-pricing-hypothesis.md#the-pilot-to-paid-offer, title: Pricing Hypothesis - The pilot-to-paid offer }
  - { id: your-data-page, resource: ../../Butler.UI/src/screens/YourDataScreen.tsx, title: In-app Your data page text (#125) }
  - { id: vision-v1-scope, resource: 10-product-vision.md#what-we-are-not-building-in-v1, title: Product Vision - What we are NOT building in v1 }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-15T08:23:42Z }
---

# Pilot One-Pager

> **In one line:** Use Butler free for six weeks, give us 10 minutes a week, then decide.

Written for [issue #136](https://github.com/jasoncavaliere/the-butler-did-it/issues/136) as a **proposal** the owner ratifies in review.

## What your family gets

- Butler free for six weeks, no card up front.
- A shared hub on a tablet you already own, with no logins for family members.
- Fair, visible chores.
- One grocery flow, where a person confirms each cart.
- An Insights screen for the organizer.

## What we ask

- A six-week pilot. Pilot week 1 is the first full Monday-to-Sunday week after setup.
- A 10-minute check-in with the organizer every pilot week, six in all. The week-5 check-in comes after week 4 ends.
- The hub in a common room, used by the whole household.
- At the week-5 check-in, the organizer reads us their household's numbers for weeks 1-4, with the cart count from Butler's API (we help), and answers price questions.

## What we measure

After week 4, four measures decide if we build more, change course, or stop. The [Pilot Success Criteria](15-pilot-success-criteria.md) define them: weekly active households (the share of pilot households active in week 4), fairness trend, carts confirmed per month, and distinct participants per week.

## Privacy

This repeats the in-app Your data page, which shows what Butler keeps and how to clear it.

- Butler runs locally, on the organizer's computer.
- Butler sends no household data out of your home. Grocery orders go to a practice store.
- The grocery mic uses the browser's speech recognition, which some browsers run online. Butler keeps only the words added to the cart.
- A child's profile holds only a first name, a child flag, and a claim color. No last name, birthday, photo, email, or password.
- Kids tap their name and never sign in.
- The organizer can delete the household, which removes all its data and cannot be undone.

## What happens after the pilot

- At the week-5 check-in, we share the results and introduce the offer.
- At the end of week 6, the organizer is [offered](12-pricing-hypothesis.md#the-pilot-to-paid-offer) $49 a year for the first 12 months, then the $69 list price, with notice first.
- Only the organizer pays, with 14 days to decide while the hub keeps working.
- Joining means a pre-payment or a signed commitment to pay.
- If you do not join, the organizer can delete the household and all its data.

## Related

- [Product Vision](10-product-vision.md) - the v1 scope this pilot offers.
- [Pricing Hypothesis](12-pricing-hypothesis.md) - the full pilot-to-paid offer.
- [Pilot Success Criteria](15-pilot-success-criteria.md) - the metric thresholds.
