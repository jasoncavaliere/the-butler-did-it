---
type: Epic
title: Epic 10 - Foundations & Delivery Rails
description: Architecture skeleton, Table Storage, organizer auth seam, test harnesses, and CI, so every later ticket's gates are real. Lands first.
tags: [epic:foundations]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# Epic 10 - Foundations & Delivery Rails

**Goal:** stand up the architecture skeleton, storage, auth seam, test harness, and CI so every later ticket is implementable and its gates are real. Butler today is bare scaffolds (`Butler.API/src/Butler.Api` is just `Program.cs`; `Butler.UI` is a bare Expo app; no test projects; no CI). This epic fixes that, mirroring the QControl house style documented in [Engineering Contract](07-engineering-contract.md).

**Serves:** FR-1, BO-6, and (as a dependency) all other objectives.
**Lands first.** Everything else is `Blocked by` this epic.

Each ticket is its own file under `tickets/` and is a ready-to-file GitHub issue. File per [brd/filing-guide.md](filing-guide.md). Replace `#<Fn>` placeholders with real issue numbers after filing. Every ticket assumes the [Engineering Contract](07-engineering-contract.md) as binding and does not restate it.

## Tickets

- [F1: Establish Butler.API layered skeleton (MediatR + feature-extension pattern)](tickets/F1-establish-butler-api-layered-skeleton-mediatr.md) - Turn the bare Butler.Api scaffold into the layered MediatR skeleton every feature plugs into (Contract 7.2).
- [F2: Butler.API test harness (xUnit + NSubstitute)](tickets/F2-butler-api-test-harness-xunit-nsubstitute.md) - The Butler.Api.Tests project (xUnit + NSubstitute) so dotnet test is a real gate for every later ticket.
- [F3: Azure Table Storage access layer + Azurite local development](tickets/F3-azure-table-storage-access-layer-azurite-local.md) - Shared Table Storage access seam with optimistic-concurrency helpers, and local development on Azurite.
- [F4: Butler.UI app structure + component test harness](tickets/F4-butler-ui-app-structure-component-test-harness.md) - Real Butler.UI app structure, navigation, typed config, and a jest-expo test harness.
- [F5: CI workflows for API and UI (GitHub Actions)](tickets/F5-ci-workflows-for-api-and-ui-github-actions.md) - GitHub Actions CI that runs the API and UI gates on every PR.
- [F6: Organizer authentication seam (Entra External ID + JWT bearer, dev-mode bypass)](tickets/F6-organizer-authentication-seam-entra-external-id.md) - Organizer JWT bearer auth (Entra External ID) and an Organizer policy, with a dev-mode bypass.
- [F7: UI API client + household context provider](tickets/F7-ui-api-client-household-context-provider.md) - Typed UI API client (errors, ETag passthrough) and a HouseholdContext provider for the current householdId.
