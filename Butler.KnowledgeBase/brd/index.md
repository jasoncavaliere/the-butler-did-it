# Start here

* [Engineering Contract](07-engineering-contract.md) - The binding rules every v1 ticket assumes, split into one file per clause (7.1 to 7.7) so an agent opens only the clause it needs.
* [Ticket to issue map](ticket-issue-map.md) - Generated map from each v1 ticket ID to its ticket file, epic, priority, blockers, and GitHub issue number.
* [Filing guide](filing-guide.md) - Why the core v1 decisions were made, the epic dependency order, the label taxonomy, how to file a ticket file as a GitHub issue, and the spec checklist.

# Engineering Contract clauses

* [7.1 Repository and toolchains](engineering-contract/71-repository-and-toolchains.md) - One repo, two sub-services with independent toolchains, and the exact build, lint, test, and export gates each ticket must name.
* [7.2 Butler.API architecture](engineering-contract/72-api-architecture.md) - The Butler.API request path (thin controller, MediatR handler, service, repository) and the feature-extension registration pattern.
* [7.3 Data model](engineering-contract/73-data-model.md) - Every Azure Table Storage table, its PartitionKey (always householdId) and RowKey, and the fields each row carries.
* [7.4 Authentication and authorization](engineering-contract/74-authentication-and-authorization.md) - Entra External ID JWT auth for the organizer only, no-password tap-to-claim sessions for participants, and the hub-device credential.
* [7.5 Cross-cutting conventions](engineering-contract/75-cross-cutting-conventions.md) - Binding conventions for every ticket: RFC 7807 errors, optimistic concurrency via ETag, injected time, and config handling.
* [7.6 Fair-assignment algorithm](engineering-contract/76-fair-assignment-algorithm.md) - The deterministic v1 fair-assignment algorithm, specified step by step so no ticket has to guess or reinterpret it.
* [7.7 Testing and Definition of Done](engineering-contract/77-testing-and-definition-of-done.md) - The Definition of Done: named tests, the 98 percent coverage gate in both sub-services (90 percent for UI presentation code during the demo push), green gates, and an approving independent review.

# Epics (implementation order)

* [10 Foundations](10-epic-foundations.md) - Architecture skeleton, Table Storage, organizer auth seam, test harnesses, and CI, so every later ticket's gates are real. Lands first.
* [20 Household Model](20-epic-household-model.md) - The household spine: the household aggregate plus rooms, people, and chores CRUD, and the organizer onboarding UI.
* [30 Tap-to-Claim & Hub](30-epic-tap-to-claim-hub.md) - No-password tap-to-claim, the always-on hub shell, organizer sign-in, and hub device pairing.
* [50 Grocery Assisted Cart](50-epic-grocery-assisted-cart.md) - One demoable grocery flow: the IStoreConnector seam with a simulated HEB catalog, cart, capture, and the confirm step.
* [40 Chores & Fair Assignment](40-epic-chores-fair-assignment.md) - The v1 wedge: the deterministic fair-assignment engine, tap-to-complete chore board, and the fairness balance view.
* [60 Offline PWA](60-epic-offline-pwa.md) - Installable, offline-tolerant PWA: manifest and service worker, last-known-week cache, durable write queue, and offline status UI.

# Tickets

* [Tickets](tickets/) - One file per ticket, named `<ID>-<slug>.md`. Find one by ID with `ls tickets/C2-*`; each epic lists its own.

# Background

* [BRD master](00-brd-master.md) - The v1 business requirements: problem, objectives, scope decisions, personas, journeys, functional requirements, and success metrics. Not needed for implementation.
