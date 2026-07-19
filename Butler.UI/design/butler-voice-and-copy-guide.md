---
title: Butler voice and copy guide
spike: 42
status: accepted
audience: engineers, PM, brand
last-reviewed: 2026-07-19
related: [Butler.KnowledgeBase/adr/0001-brand-mood-and-voice.md, design-decision-record.md]
---

# Butler voice and copy guide

This guide turns the calm concierge personality (ADR-0001) into copy rules anyone
can apply. When copy is in doubt, read it out loud and ask one question: does this
sound like a gracious concierge, or like an app nagging the family? If it nags, it
is wrong. Plain ASCII only, straight quotes, no em dashes.

## The persona

Butler is a calm concierge for the whole household. It is warm, dignified, and
quietly helpful. It already handled the hard part and is simply letting you know.
It is understated, competent, and gracious. It is friendly and legible for kids
without turning into a toy. It never scolds, never gamifies, and never rushes.

Three quick tests for any line:

- Would a good concierge say it this way, out loud, in a calm voice?
- Does it respect the reader, including a child, without talking down?
- Does it avoid urgency, blame, points, streaks, and exclamation-mark hype?

## Label conventions

- Use active-voice verbs for actions: "Add to cart", "Confirm order", "Mark done",
  "Sign in". Not "Submission" or "Cart addition".
- Label the thing, plainly: "Today", "This week", "Groceries", "Balance".
- Bind a visible label to every input; never use the placeholder as the label.
- Keep it short enough to read at a glance. One idea per line on the hub.
- Sentence case, not all caps. Caps read as shouting on a shared wall.

## Empty-state voice

Empty is gracious, not blank. It tells the reader that nothing is wrong.

- Do: "All caught up." / "Nothing due today. Enjoy the quiet." / "No chores left for
  you. Nice work."
- Do not: "You have no tasks." (flat) / "Empty." (reads as broken) / "0 items."

## Error-state voice

Errors stay calm and offer a way forward. Always pair an icon and text with color,
never color alone (ADR-0007, ADR-0010).

- Do: "That did not go through. Tap to try again." / "We could not reach Butler.
  Your taps are saved and will sync." / "That name is already taken. Pick another."
- Do not: "Error 500." / "Failed!" / "Something went wrong" with no next step.
- Never blame the person. The system owns the problem and the recovery.

## Offline-state voice

Offline is normal, not an alarm. The board still works, so say so quietly (ADR-0007).

- Do: "Offline. Showing last synced 9:12am." / "Saved. Will sync when you are back
  online." / a small clock glyph on a queued item that resolves to a check on sync.
- Do not: a red banner. / "Connection lost!" / "You are offline" with no reassurance
  that the board is still usable.

## The never list

- Never nag: "You forgot!", "Overdue!", "You still have chores."
- Never gamify: points, streaks, badges, confetti, a leaderboard, a number one.
- Never shame the person doing the most. Fairness is framed as trending toward even
  (ADR-0009), not as a ranking.
- Never shout: no all caps, no stacked exclamation marks.
- Never make offline or empty read as broken.

## A few worked examples

| Situation | Say this | Not this |
| --- | --- | --- |
| Person has no items | All caught up. | You have 0 tasks. |
| Chore completed | (quiet check, muted row, brief Undo) | Great job!! +10 points |
| Network dropped | Offline. Showing last synced 9:12am. | Connection lost! |
| Write queued | Saved. Will sync when you are back online. | Could not save. |
| Ready to begin | Ready when you are. | Get started now! |
| Fairness balanced | Balanced this week. | You are in last place. |
