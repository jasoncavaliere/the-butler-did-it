---
type: Architecture
title: Architecture Overview (v1)
description: "How v1 is built: a map of each locked architecture decision, linked to the binding Engineering Contract clause."
tags: [architecture, v1, azure table storage, mediatr, cqrs, entra external id, tap-to-claim, store connector]
category: Architecture
lifecycle: Living
owner: agent-managed
related: [10-product-vision, 90-glossary]
sources:
  - { id: contract, resource: ../brd/07-engineering-contract.md, title: Butler v1 Engineering Contract }
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# Architecture Overview (v1)

> **In one line:** How Butler v1 is built - the shape of the system that serves the vision's loop, with every locked decision summarized and linked back to the binding detail in the BRD.

This article is a map, not the territory. It summarizes the v1 architecture and points at where each decision is specified in full. The binding detail lives in the BRD [Engineering Contract](90-glossary.md#engineering-contract), Section 7 of the master BRD, and this article does not restate it. When you are about to write code, read the authoritative source: [`brd/07-engineering-contract.md`](../brd/07-engineering-contract.md). If this summary and the BRD ever disagree, the BRD wins and this page is stale - fix it here.

The architecture exists to serve two kinds of input. The functional inputs are the journeys the system must run: the v1 loop from the vision. The non-functional inputs are the locked decisions about how it is built: storage, API shape, identity, and the gates that keep it honest. Both are below.

## Functional inputs (the v1 loop)

These are the end-to-end journeys the architecture has to serve. Each is specified in the BRD's [end-to-end user journeys](../brd/00-brd-master.md#6-end-to-end-user-journeys-the-v1-loop); the glossary defines the terms they lean on.

- **Onboarding (organizer, once).** The [Household Organizer](90-glossary.md#household-organizer) signs in on the hub, creates the household, and populates the [Household Model](90-glossary.md#household-model) - rooms, then people, then chores. They pair the tablet as the household's [Hub](90-glossary.md#the-hub) device. This is the only login in the product.
- **The daily glance (any participant, ambient).** A participant walks past, uses [tap-to-claim](90-glossary.md#tap-to-claim) to see what is theirs, and taps a chore done. No password, no install.
- **Weekly fair assignment (automatic).** Butler runs [Chore Mapping and Fair Assignment](90-glossary.md#chore-mapping-and-fair-assignment) to balance the chore load across eligible people, respecting the child flag.
- **The grocery wow (monthly).** A voice or text capture flows into this week's cart against a simulated store catalog behind the [Store Connector](90-glossary.md#store-connector) seam. The organizer reviews and confirms the [Assisted Cart](90-glossary.md#assisted-cart) - a human stays on the final tap.
- **Offline (any time).** The hub keeps rendering the last-known week with no network. Writes queue locally and sync when the connection returns.

## Non-functional inputs (how it is built)

One entry per locked decision. Each is a summary that links to its authoritative source, not a copy.

- **Persistence.** Azure Table Storage partitioned by `householdId`, plus Blob and Queues, all behind repository interfaces. No EF Core and no relational database. The choice is about cost and fit: the household model is a natural per-`householdId` aggregate, so every product read and write is a single-partition operation, and idle cost stays near zero. See the [data model](../brd/engineering-contract/73-data-model.md) and decision D-1 in [Section 5.3](../brd/00-brd-master.md#53-scope-decisions-that-resolve-would-be-material-assumptions); the short rationale is in [`brd/filing-guide.md`](../brd/filing-guide.md).
- **API architecture.** Layered with MediatR CQRS, adopted from the QControl house style: Controller (thin) to MediatR command or query to Handler to Application Service to Repository to Azure Storage. Features compose through an `Add<Feature>Feature()` extension registered in `Program.cs`. Central package management, `TreatWarningsAsErrors`, targeting .NET 10. See [Section 7.2](../brd/engineering-contract/72-api-architecture.md).
- **Identity.** The organizer authenticates through Microsoft Entra External ID as a JWT bearer. Participants use no-password [tap-to-claim](90-glossary.md#tap-to-claim). Sensitive actions sit behind the organizer policy, the hub tablet is a paired device identity, and no money moves in v1 (D-3, D-8). See [Section 7.4](../brd/engineering-contract/74-authentication-and-authorization.md).
- **Grocery.** A real `IStoreConnector` seam with a deterministic `SimulatedHebConnector`, because HEB has no public consumer API. Capture sits behind an `ICaptureSource` seam so live Alexa can drop in later (D-4, D-5). See the connector detail in [Section 7.2](../brd/engineering-contract/72-api-architecture.md) and decisions D-4 and D-5 in [Section 5.3](../brd/00-brd-master.md#53-scope-decisions-that-resolve-would-be-material-assumptions).
- **Determinism.** Time and randomness are injected, and the fair-assignment algorithm is a deterministic pure function (D-6). Same inputs always produce the same assignment set, so it is unit-tested against fixed inputs. See [Section 7.6](../brd/engineering-contract/76-fair-assignment-algorithm.md).
- **Quality gate.** A hard 98 percent coverage gate on lines, methods, and branches for the code sub-services, enforced by the build and by CI, so a PR that drops below the bar cannot merge. See [Section 7.7](../brd/engineering-contract/77-testing-and-definition-of-done.md).
- **Repository and toolchains.** One repo, `the-butler-did-it`, with two sub-services on independent gates and no root build: `Butler.API/` on .NET 10 and `Butler.UI/` on Expo, web-first (D-7). See [Section 7.1](../brd/engineering-contract/71-repository-and-toolchains.md).
- **UI.** `Butler.UI/` is an Expo web-first, installable, offline-tolerant PWA - the [BYO-tablet](90-glossary.md#byo-tablet) hub. See the vision's [shared hub](10-product-vision.md#the-product-a-shared-hub-not-a-phone-app).

There are cross-cutting conventions every ticket also inherits - RFC 7807 error shapes, optimistic concurrency, injected time - specified in [Section 7.5](../brd/engineering-contract/75-cross-cutting-conventions.md).

## How the pieces fit

Follow one write request to see how the layers connect. A participant taps a chore done on the hub. The UI sends an HTTP request to `Butler.API`. A thin Controller receives it and does almost nothing except hand a MediatR command to the sender. MediatR routes the command to its Handler, passing through the pipeline behaviors first (logging, validation, exception mapping). The Handler calls the feature's Application Service, which holds the orchestration logic. The Application Service reads and writes through a Repository interface, and the Azure-backed repository stores the completion in a Table partitioned by `householdId`. The response flows back out the same path. Every product read and write stays inside one household's partition. The binding detail of this path is [Section 7.2](../brd/engineering-contract/72-api-architecture.md).

## Sources

- [`brd/00-brd-master.md`](../brd/00-brd-master.md) - the master BRD. Section 7 is the binding [Engineering Contract](../brd/07-engineering-contract.md); Section 5.3 holds the [scope decisions](../brd/00-brd-master.md#53-scope-decisions-that-resolve-would-be-material-assumptions) (D-1 through D-8) this article summarizes.
- [`brd/index.md`](../brd/index.md) - the BRD map: master, contract clauses, epics, and tickets.
- [`brd/filing-guide.md`](../brd/filing-guide.md) - the short rationale behind Table Storage, Entra External ID, and the simulated connector, plus the dependency order.
- The `intake/` folder - the raw vision and build brief that the BRD and this KB derive from. Provenance; keep it.

## Related

- [Product Vision](10-product-vision.md) - the why behind every decision summarized here.
- [Glossary](90-glossary.md) - every term used above, defined once.
