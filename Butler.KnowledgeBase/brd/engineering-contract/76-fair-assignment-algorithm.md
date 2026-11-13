---
type: Contract Clause
title: Engineering Contract 7.6 - The v1 fair-assignment algorithm (deterministic, specified so nobody guesses)
description: The deterministic v1 fair-assignment algorithm, specified step by step so no ticket has to guess or reinterpret it.
tags: [engineering-contract, binding]
contract: ../07-engineering-contract.md
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# 7.6 The v1 fair-assignment algorithm (deterministic, specified so nobody guesses)

> Part of the binding [Engineering Contract](../07-engineering-contract.md). Read this clause on its own; the other clauses are listed there.

Given a household's active chores for a week and its eligible people:

1. **Eligibility:** a person is eligible for a chore if `IsChild == false`, or the chore's `MinAge` is null, or the person is a child but the chore is flagged child-safe (`MinAge` null or a child-eligible cadence). v1 rule: children are eligible only for chores with `MinAge == null`.
2. **Load:** each person's running load = sum of `Effort` of their `ChoreCompletions` over the trailing 4 weeks, plus effort already assigned this week.
3. **Assignment:** process chores in descending `Effort`, then by `choreId` for stability. Assign each chore to the eligible person with the lowest current load; break ties by fewest chores assigned this week, then by `personId`. Add the chore's effort to that person's load.
4. **Determinism:** same inputs always produce the same assignment set. This is a pure function, unit-tested with fixed inputs. No ML, no learning, no external calls.
