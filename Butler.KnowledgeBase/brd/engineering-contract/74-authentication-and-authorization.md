---
type: Contract Clause
title: Engineering Contract 7.4 - Authentication and authorization
description: Entra External ID JWT auth for the organizer only, no-password tap-to-claim sessions for participants, and the hub-device credential.
tags: [engineering-contract, binding]
contract: ../07-engineering-contract.md
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# 7.4 Authentication and authorization

> Part of the binding [Engineering Contract](../07-engineering-contract.md). Read this clause on its own; the other clauses are listed there.

- **Organizer:** Entra External ID -> JWT bearer (`Microsoft.AspNetCore.Authentication.JwtBearer`). The organizer's object id maps to a `People` row with role `Organizer`.
- **`Organizer` policy:** endpoints that mutate the household structure, pair devices, or confirm a cart carry `[Authorize(Policy = "Organizer")]`.
- **Dev mode:** `Authentication:DisableAuthentication=true` (Development + CI default) makes the policy permissive so local runs and tests need no live tenant. Non-Development environments fail closed.
- **Participants and the hub device** are never authenticated as users. The hub presents a paired device/household token to read the household and record completions; sensitive actions still require an organizer JWT.
