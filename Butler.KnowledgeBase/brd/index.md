# Start here

* [Engineering Contract](07-engineering-contract.md) - The binding rules every v1 ticket assumes. Lists the seven clauses; open only the one you need.
* [Ticket to issue map](ticket-issue-map.md) - Generated crosswalk from ticket ID (F1, C2, ...) to its ticket file, epic, and GitHub issue.
* [Filing guide](filing-guide.md) - Why the core v1 decisions were made, the epic dependency order, the label taxonomy, and how to file a ticket as an issue.

# Engineering Contract clauses

* [7.1 Repository and toolchains](engineering-contract/71-repository-and-toolchains.md) - One repo, two sub-services with independent toolchains, and the gates each ticket must name.
* [7.2 Butler.API architecture](engineering-contract/72-api-architecture.md) - The request path (thin controller, MediatR handler, service, repository) and feature-extension registration.
* [7.3 Data model](engineering-contract/73-data-model.md) - Every Table Storage table, its keys (PartitionKey is always householdId), and its fields.
* [7.4 Authentication and authorization](engineering-contract/74-authentication-and-authorization.md) - Organizer JWT auth, no-password tap-to-claim sessions, and the hub-device credential.
* [7.5 Cross-cutting conventions](engineering-contract/75-cross-cutting-conventions.md) - RFC 7807 errors, optimistic concurrency via ETag, injected time, and config handling.
* [7.6 Fair-assignment algorithm](engineering-contract/76-fair-assignment-algorithm.md) - The deterministic v1 fair-assignment algorithm, step by step.
* [7.7 Testing and Definition of Done](engineering-contract/77-testing-and-definition-of-done.md) - Named tests, the 98 percent coverage gate, green gates, and an approving review.

# Epics (implementation order)

* [10 Foundations](10-epic-foundations.md) - Architecture skeleton, Table Storage, organizer auth seam, test harnesses, and CI. Lands first.
* [20 Household Model](20-epic-household-model.md) - The household aggregate plus rooms, people, and chores, and the organizer onboarding UI.
* [30 Tap-to-Claim & Hub](30-epic-tap-to-claim-hub.md) - No-password tap-to-claim, the always-on hub shell, organizer sign-in, and hub pairing.
* [50 Grocery Assisted Cart](50-epic-grocery-assisted-cart.md) - The store-connector seam with a simulated HEB catalog, cart, capture, and the confirm step.
* [40 Chores & Fair Assignment](40-epic-chores-fair-assignment.md) - The fair-assignment engine, tap-to-complete board, and the fairness view.
* [60 Offline PWA](60-epic-offline-pwa.md) - Installable PWA, last-known-week cache, durable write queue, and offline status UI.

# Tickets

* [Tickets](tickets/) - One file per ticket, named `<ID>-<slug>.md`. Find one by ID with `ls tickets/C2-*`; each epic lists its own.

# Background

* [BRD master](00-brd-master.md) - Problem, objectives, scope decisions, personas, journeys, and metrics. Not needed for implementation.
