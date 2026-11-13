---
type: Contract Clause
title: Engineering Contract 7.3 - Data model (Azure Table Storage - partition key is always `householdId`)
description: Every Azure Table Storage table, its PartitionKey (always householdId) and RowKey, and the fields each row carries.
tags: [engineering-contract, binding]
contract: ../07-engineering-contract.md
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# 7.3 Data model (Azure Table Storage - partition key is always `householdId`)

> Part of the binding [Engineering Contract](../07-engineering-contract.md). Read this clause on its own; the other clauses are listed there.

Tables (PartitionKey / RowKey), all in one storage account:

| Table | PartitionKey | RowKey | Key fields |
| --- | --- | --- | --- |
| `Households` | `householdId` | `householdId` | Name, OrganizerObjectId, CreatedUtc |
| `Rooms` | `householdId` | `roomId` | Name, SortOrder |
| `People` | `householdId` | `personId` | DisplayName, Role (`Organizer`/`Participant`), IsChild, ClaimColor, OrganizerObjectId (organizer only) |
| `Chores` | `householdId` | `choreId` | Title, RoomId, Cadence (`Daily`/`Weekly`), Effort (int), MinAge (nullable), Active |
| `Assignments` | `householdId` | `{weekIso}_{choreId}` | AssignedPersonId, WeekIso, DueDateUtc, Status (`Open`/`Done`) |
| `ChoreCompletions` | `householdId` | `{completedUtcTicks}_{choreId}` | ChoreId, PersonId, CompletedUtc, Effort, WeekIso |
| `Carts` | `householdId` | `{weekIso}` | Status (`Building`/`Confirmed`), ConfirmedByPersonId, ConfirmedUtc |
| `CartItems` | `householdId` | `{cartWeekIso}_{itemId}` | ProductId, DisplayName, Quantity, AddedByPersonId, SourceConnector |
| `HubDevices` | `householdId` | `deviceId` | DeviceName, PairedUtc, LastSeenUtc |

Rules:
- `householdId` scopes every read and write. No cross-household query exists in the product hot path.
- Mutable content uses optimistic concurrency: reads return `ETag`, updates require `If-Match` (`428` if missing, `412` if stale). Shared helper lives in Foundations.
- A `SeedData/` fallback + Azurite let the API run locally with no cloud storage (mirrors QControl's strategy pattern).
- `weekIso` is the ISO-8601 year-week string (for example `2026-W29`), computed server-side from a supplied or current date. Deterministic; never `DateTime.Now` inside a handler without injection.
