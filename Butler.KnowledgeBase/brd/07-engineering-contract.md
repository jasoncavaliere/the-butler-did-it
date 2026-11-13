---
type: Engineering Contract
title: Butler v1 Engineering Contract (BRD Section 7)
description: The binding rules every v1 ticket assumes, split into one file per clause (7.1 to 7.7) so an agent opens only the clause it needs.
tags: [engineering-contract, binding, brd]
owner: engineering
sources:
  - { id: brd-master, resource: 00-brd-master.md, title: Butler v1 BRD master }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# Butler v1 - Engineering Contract (BRD Section 7)

> **Binding for every ticket.** Split out of the [master BRD](00-brd-master.md) so implementing agents can read the contract without the product sections. Section numbers (7.1-7.7) are unchanged; each clause is its own file.

## The anti-halt contract

**This section is the reason the tickets can be implemented unattended.** Every epic ticket references it instead of restating it, and treats it as binding. It encodes the QControl house style (the org's proven .NET pattern) applied to Butler.

## Clauses

Open only the clause your ticket needs.

- [7.1 Repository and toolchains](engineering-contract/71-repository-and-toolchains.md) - One repo, two sub-services with independent toolchains, and the exact build, lint, test, and export gates each ticket must name.
- [7.2 Butler.API architecture (layered, MediatR, adopted from QControl)](engineering-contract/72-api-architecture.md) - The Butler.API request path (thin controller, MediatR handler, service, repository) and the feature-extension registration pattern.
- [7.3 Data model (Azure Table Storage - partition key is always `householdId`)](engineering-contract/73-data-model.md) - Every Azure Table Storage table, its PartitionKey (always householdId) and RowKey, and the fields each row carries.
- [7.4 Authentication and authorization](engineering-contract/74-authentication-and-authorization.md) - Entra External ID JWT auth for the organizer only, no-password tap-to-claim sessions for participants, and the hub-device credential.
- [7.5 Cross-cutting conventions (binding for every ticket)](engineering-contract/75-cross-cutting-conventions.md) - Binding conventions for every ticket: RFC 7807 errors, optimistic concurrency via ETag, injected time, and config handling.
- [7.6 The v1 fair-assignment algorithm (deterministic, specified so nobody guesses)](engineering-contract/76-fair-assignment-algorithm.md) - The deterministic v1 fair-assignment algorithm, specified step by step so no ticket has to guess or reinterpret it.
- [7.7 Testing and Definition of Done (what makes a ticket's AC verifiable)](engineering-contract/77-testing-and-definition-of-done.md) - The Definition of Done: named tests, the 98 percent coverage gate in both sub-services (90 percent for UI presentation code during the demo push), green gates, and an approving independent review.

## Related

- [00-brd-master.md](00-brd-master.md) - the master BRD (problem, scope, journeys, traceability); this file is its Section 7.
- [brd/filing-guide.md](filing-guide.md) - core-decision rationale, label taxonomy, dependency order.
- [ticket-issue-map.md](ticket-issue-map.md) - ticket ID to GitHub issue crosswalk.
