---
type: Template
title: Feedback Log Template
description: "A copy-paste template for logging each post-demo customer conversation (date, household shape, quotes, objections, pricing answers, and follow-up), with filled entries kept out of this public repo."
tags: [feedback log, template, customer interviews, demo, go to market, follow-up, privacy]
category: Product & Strategy
lifecycle: Living
owner: agent-managed
related: [12-pricing-hypothesis, 13-customer-interview-guide]
sources:
  - { id: issue-139, resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/139, title: S6 - Customer interview guide and feedback log }
  - { id: interview-guide, resource: 13-customer-interview-guide.md, title: Customer Interview Guide }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-14T16:46:17Z }
---

# Feedback Log Template

> **In one line:** Log every post-demo conversation as one entry with the same fields, so answers from different households can be read side by side, and keep the filled entries out of this public repo.

This template was written on **2026-11-14** for [issue #139](https://github.com/jasoncavaliere/the-butler-did-it/issues/139), and it is the record side of the [Customer Interview Guide](13-customer-interview-guide.md): the guide says what to ask, and this page says how to write down what you heard. It is also where Stage A of the pricing experiment is recorded, as the [Pricing Hypothesis](12-pricing-hypothesis.md#experiment-design) asks.

## Keep filled entries out of this repo

This repository is public, so it holds only the blank template. Never commit a filled entry here, even a partial one.

- Keep the completed log in a private location that only the team can access.
- Name each household by a code such as H-01, never by a family name, street, school, or employer.
- Quote people by their role in the household, such as "organizer" or "teen", never by name.
- Leave out anything that could identify a household when combined, such as a town plus the children's ages.
- If a household asks for its notes to be deleted, delete its entry and say so in the follow-up field.

## Fields

Every entry has the same twelve fields in the same order, and an unanswered field says "not asked" rather than staying blank, so every gap is visible.

| Field | What to write |
| --- | --- |
| **Date** | The day of the conversation, as YYYY-MM-DD. |
| **Household code** | A code such as H-01, assigned in order. Never a name. |
| **Interviewer** | Who asked the questions and who took notes. |
| **Demo context** | Where and how the demo ran, and which parts of Butler were shown. |
| **Household shape** | Who lives there, by role and rough age band, such as "two adults, kids 6 and 11". This is how we compare households without naming anyone. |
| **Who carries the load** | Who keeps the household list in their head, in the household's own words (questions 7 and 8). |
| **Current tools** | What the household uses today for chores, lists, groceries, and voice, and anything they tried and dropped (questions 3 to 6). |
| **Quotes** | Their exact words, in straight double quotes, each tagged with the speaker's role and the question number. |
| **Objections** | Each reason they gave not to use Butler, tagged with the vision risk it matches, or "new" if it matches none (questions 11 and 12). |
| **Willingness to pay** | Each pricing answer against its Pricing Hypothesis question number, Q1 to Q10. |
| **Pilot interest** | Whether they want to join a pilot, in their words, and any condition they set. |
| **Follow-up** | What we promised, who owns it, and by when, plus anything to ask next time. |

## Copy-paste entry

Copy this block once per conversation into the private log and fill in every line.

```markdown
### H-00 - YYYY-MM-DD

- Date: YYYY-MM-DD
- Household code: H-00
- Interviewer: asked by (role), notes by (role)
- Demo context: where it ran; parts shown (hub, chores, fairness, grocery)
- Household shape: adults (count); children (age bands); anyone else at home
- Who carries the load: in their words
- Current tools:
  - Chores and lists:
  - Grocery:
  - Voice assistant:
  - Tried and dropped, and why:
- Quotes:
  - "exact words" (role, Q#)
  - "exact words" (role, Q#)
- Objections:
  - objection (matching vision risk, or "new")
- Willingness to pay:
  - Q1 too cheap:
  - Q2 bargain:
  - Q3 getting expensive:
  - Q4 too expensive:
  - Q5 ladder (89 / 69 / 49):
  - Q6 pays today:
  - Q7 would miss most:
  - Q8 decides to pay / actually pays:
  - Q9 per household or per person:
  - Q10 own tablet or buy one:
- Pilot interest: yes, no, or maybe, in their words, plus any condition
- Follow-up:
  - what we promised, owner, due date
  - what to ask next time
```

The pricing lines follow the numbering of the [willingness-to-pay questions](12-pricing-hypothesis.md#willingness-to-pay-questions). The short labels are navigation aids, not the questions themselves, so always read the complete wording from that article.

## Reading across entries

One entry is an anecdote, and the value of the log is in reading many entries side by side. Review the log after every five entries, which is a working rule rather than a measured figure.

Count how often each objection appears, and group them by the vision risk they match. Look for quotes that keep coming back in different words, because those are the claims the vision may need to answer. Compare the willingness-to-pay lines across households in the way the Pricing Hypothesis [measures](12-pricing-hypothesis.md#measures) describe. Treat every pattern as directional only, since a handful of households is too few for a significant result.

## Related

- [Customer Interview Guide](13-customer-interview-guide.md) - the questions whose answers fill each entry, and how to run the conversation.
- [Pricing Hypothesis](12-pricing-hypothesis.md) - the willingness-to-pay questions behind the pricing lines, and the experiment this log records Stage A of.
