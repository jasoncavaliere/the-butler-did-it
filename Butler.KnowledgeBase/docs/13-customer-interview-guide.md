---
type: Guide
title: Customer Interview Guide
description: "Twelve open questions to ask a household right after a Butler demo, each tied to the Product Vision risk, retention thesis, or business-model claim it tests, and how to run and log the conversation."
tags: [customer interviews, discovery, demo, go to market, risks, retention, willingness to pay, pilot]
category: Product & Strategy
lifecycle: Living
owner: agent-managed
related: [10-product-vision, 12-pricing-hypothesis, 14-feedback-log-template]
sources:
  - { id: issue-139, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/139, title: S6 - Customer interview guide and feedback log }
  - { id: vision-retention, resource: 10-product-vision.md#the-retention-thesis, title: Product Vision - The retention thesis }
  - { id: vision-business-model, resource: 10-product-vision.md#business-model, title: Product Vision - Business model }
  - { id: vision-risks, resource: 10-product-vision.md#risks-and-how-we-de-risk-them, title: Product Vision - Risks and how we de-risk them }
  - { id: pricing-wtp, resource: 12-pricing-hypothesis.md#willingness-to-pay-questions, title: Pricing Hypothesis - Willingness-to-pay questions }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-14T16:46:17Z }
---

# Customer Interview Guide

> **In one line:** After every Butler demo, ask the household the same twelve open questions, each one aimed at a named risk or claim in the Product Vision, and log the answers in the Feedback Log.

This guide was written on **2026-11-14** for [issue #139](https://github.com/jasoncavaliere/the-butler-did-it/issues/139), and it turns the vision's unproven claims into questions that a real household can answer from experience. Each question names the part of the [Product Vision](10-product-vision.md) it tests, so a pattern in the answers points straight at the claim that may need to change. The guide is Living: when a question stops teaching us anything, replace it here and note why in the log.

## When and how to run it

Run the interview right after a demo, while the household still has the hub in front of them. Plan on about 30 minutes, which is a working rule, not a measured figure.

- **Who to talk to:** the whole household if you can, and at least the [Household Organizer](90-glossary.md#household-organizer), who carries the mental load and is the first champion.
- **How to ask:** read each question exactly as written, then stay quiet and let the household answer in their own words. Follow up by asking what happened next, never by suggesting an answer.
- **What not to do:** do not pitch, defend the product, or promise features. If they ask about something v1 does not build, say so plainly and record it as a feature request.
- **Order:** work through the questions in numerical order, and skip one only when an earlier answer already covered it, noting the skip in the log.
- **Notes:** one person asks while another records the conversation in the [Feedback Log Template](14-feedback-log-template.md), capturing exact words wherever possible.

## The questions

The twelve questions are grouped into five areas, and every question is open-ended, so no question can be answered with a simple yes or no. The last column names the vision section the answers test, and, for a risk, the specific risk by name.

| # | Area | Question | What it tests |
| --- | --- | --- | --- |
| 1 | Problem | Walk me through last week at home. What had to get done, and what slipped through the cracks? | [The retention thesis](10-product-vision.md#the-retention-thesis): is there a daily need worth glancing at? |
| 2 | Problem | The last time something got missed, what happened next, and how did it feel? | [Business model](10-product-vision.md#business-model): is the pain sharp enough that a household pays to relieve it? |
| 3 | Current tools | What does your household use today to keep track of chores, lists, and who does what? | [Business model](10-product-vision.md#business-model): which tools Butler competes with for its line on the list |
| 4 | Current tools | Tell me about a family app or system you tried and stopped using. What made it stop? | [Risks and how we de-risk them](10-product-vision.md#risks-and-how-we-de-risk-them): **Retention and the novelty cliff** |
| 5 | Current tools | How does grocery shopping work for you today, from noticing you are out of something to it being in the kitchen? | [Risks and how we de-risk them](10-product-vision.md#risks-and-how-we-de-risk-them): **Grocery and partnership dependency** |
| 6 | Current tools | How, if at all, does your household use a voice assistant at home today? | [Risks and how we de-risk them](10-product-vision.md#risks-and-how-we-de-risk-them): **Alexa platform dependency** |
| 7 | Who carries the load | Who keeps the household list in their head, and how do the others find out what is theirs? | [The retention thesis](10-product-vision.md#the-retention-thesis): does a shared glance replace one person's push? |
| 8 | Who carries the load | Picture everyone tapping their own name on a shared kitchen screen, with no password. What would you be comfortable with, and what should it never let someone do? | [Risks and how we de-risk them](10-product-vision.md#risks-and-how-we-de-risk-them): **Tap-to-claim security trade-off** |
| 9 | Willingness to pay | What does your household pay today for family organizing apps or hubs, if anything? | [Business model](10-product-vision.md#business-model): the $40 to $90 a year band |
| 10 | Willingness to pay | Who in your household would decide to pay for Butler, and who would actually pay? | [Business model](10-product-vision.md#business-model): one price per household, and who decides to pay it |
| 11 | Objections | What would stop you from putting Butler on your kitchen wall next week? | [Risks and how we de-risk them](10-product-vision.md#risks-and-how-we-de-risk-them): log which risk the answer matches, or note a new one |
| 12 | Objections | What would have to be true for your family to still be using this three months from now? | [The retention thesis](10-product-vision.md#the-retention-thesis): the month-3 weekly-active signal |

Questions 9 and 10 are questions 6 and 8 of the [Pricing Hypothesis](12-pricing-hypothesis.md#willingness-to-pay-questions), asked word for word. Keeping the same words lets their answers be compared with every other pricing answer.

## The pricing block

Right after question 10, read the rest of the [willingness-to-pay questions](12-pricing-hypothesis.md#willingness-to-pay-questions) from the Pricing Hypothesis. Those are its questions 1 to 5, 7, 9, and 10, read exactly as written in that article and never reworded or restated here, so there is only one copy to keep current.

Together with questions 9 and 10 above, this covers all ten pricing questions in one conversation, which is Stage A of the pricing [experiment design](12-pricing-hypothesis.md#experiment-design). Record each pricing answer against its Pricing Hypothesis number in the log, so the [measures](12-pricing-hypothesis.md#measures) can be worked out across households.

Never present a price as an offer during the interview, because the price points are a hypothesis and Butler charges no household anything today.

## Coverage at a glance

This table reads in the opposite direction, from each vision section to the questions that test it, and it shows that every risk in the vision is covered by at least one question.

| Vision section | Questions |
| --- | --- |
| [The retention thesis](10-product-vision.md#the-retention-thesis) | 1, 7, 12 |
| [Business model](10-product-vision.md#business-model) | 2, 3, 9, 10, and the pricing block |
| Risks: **Grocery and partnership dependency** | 5, 11 |
| Risks: **Alexa platform dependency** | 6, 11 |
| Risks: **Tap-to-claim security trade-off** | 8, 11 |
| Risks: **Retention and the novelty cliff** ([Novelty Cliff](90-glossary.md#novelty-cliff)) | 4, 11, 12 |

## After the interview

Complete the log entry within 24 hours, while the conversation is still fresh; that deadline is a working rule rather than a measured figure.

1. Copy a blank entry from the [Feedback Log Template](14-feedback-log-template.md) and complete every field, writing "not asked" rather than leaving a field empty.
2. Tag each objection with the vision risk it matches, or with "new" if it matches none.
3. Record any follow-up you promised, with an owner and a due date.
4. After every five entries, read across them for repeated objections and quotes. If one keeps coming up, raise it as a question against the vision rather than editing the vision on the spot.

## What this does not decide

- It does not change any claim in the vision or any number in the Pricing Hypothesis, because it only collects evidence about them.
- It does not set the pilot terms, which belong to the pilot one-pager ([#136](https://github.com/jasoncavaliere/the-butler-did-it/issues/136)).
- It does not script the demo itself, which is the demo-day runbook ([#138](https://github.com/jasoncavaliere/the-butler-did-it/issues/138)).
- It does not set the pilot success criteria or the week-4 go/no-go ([#140](https://github.com/jasoncavaliere/the-butler-did-it/issues/140)).
- It does not promise any feature, so if a household asks for something v1 does not build, record it as a feature request.

## Sources

1. [Issue #139 - S6 customer interview guide and feedback log](https://github.com/jasoncavaliere/the-butler-did-it/issues/139)
2. [Product Vision - The retention thesis](10-product-vision.md#the-retention-thesis), [Business model](10-product-vision.md#business-model), and [Risks and how we de-risk them](10-product-vision.md#risks-and-how-we-de-risk-them), which this guide tests. The $40 to $90 band in question 9 is quoted from the Business model section.
3. [Pricing Hypothesis - Willingness-to-pay questions](12-pricing-hypothesis.md#willingness-to-pay-questions), the source of questions 9 and 10 and the pricing block.

## Related

- [Product Vision](10-product-vision.md) - the risks, retention thesis, and business model these questions test.
- [Pricing Hypothesis](12-pricing-hypothesis.md) - the willingness-to-pay questions asked in the pricing block, and the experiment they feed.
- [Feedback Log Template](14-feedback-log-template.md) - where every answer from this interview is recorded.
