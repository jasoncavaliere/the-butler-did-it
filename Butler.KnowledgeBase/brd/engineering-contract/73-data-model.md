---
type: Contract Clause
title: Engineering Contract 7.3 - Data model (Azure Table Storage - partition key is `householdId`, with one deployment-wide exception)
description: Every Azure Table Storage table, its PartitionKey (householdId, except the one deployment-wide Datasets row at _system) and RowKey, and the fields each row carries.
tags: [engineering-contract, binding]
contract: ../07-engineering-contract.md
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-15T11:20:36Z }
---

# 7.3 Data model (Azure Table Storage - partition key is `householdId`, with one deployment-wide exception)

> Part of the binding [Engineering Contract](../07-engineering-contract.md). Read this clause on its own; the other clauses are listed there.

Tables (PartitionKey / RowKey), all in one storage account. Every table is partitioned by `householdId` except `Datasets`, which holds one deployment-wide row (see [the exception](#exception-the-deployment-wide-datasets-row) below):

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
| `Events` | `householdId` | `{occurredUtcTicks:D19}_{eventGuid}` | Type (an `EventTypes` value, for example `chore-completed`/`hub-glanced`), OccurredUtc, PersonId, ChoreId, WeekIso, ItemId (each nullable); append-only, ids only, never free text |
| `Datasets` | `_system` (fixed, deployment-wide; see the exception below) | `dataset` (fixed; the only row) | DatasetId (GUID, "N" format), CreatedUtc |

Rules:
- `householdId` scopes every read and write, except the single deployment-wide `Datasets` row. No cross-household query exists in the product hot path.
- Mutable content uses optimistic concurrency: reads return `ETag`, updates require `If-Match` (`428` if missing, `412` if stale). Shared helper lives in Foundations.
- A `SeedData/` fallback + Azurite let the API run locally with no cloud storage (mirrors QControl's strategy pattern).
- `weekIso` is the ISO-8601 year-week string (for example `2026-W29`), computed server-side from a supplied or current date. Deterministic; never `DateTime.Now` inside a handler without injection.

## Exception: the deployment-wide Datasets row

The `Datasets` table holds exactly one row: the id of the dataset the whole deployment is currently serving (#100). The id is regenerated on every demo seed (and whenever storage is wiped), and the hub compares it with the id it last saw: on a change it drops its offline cache and its queued writes, because they belong to data that no longer exists.

- **Keys.** The row lives at the fixed PartitionKey `_system` and the fixed RowKey `dataset`. It is not partitioned by `householdId` because the dataset id covers the whole deployment, not one household.
- **Owner.** `DatasetEntity` and `IDatasetService` in Butler.API own the row; see the section "System (health + dataset id + build version)" in `Butler.API/ARCHITECTURE.md`.
- **Why it cannot collide with a household id.** Household ids are server-generated: a GUID in `"N"` format (32 lowercase hex characters) or the fixed demo id `demo-household`. No endpoint accepts a caller-chosen household id. `_system` contains an underscore, which is not a hex character, and it is not `demo-household`, so no household partition can ever equal it. Household teardown purges partition `householdId` in every table, so it never touches the `_system` row.
- **Only exception.** This is the only table not partitioned by `householdId`. Any future table that is not household-scoped must use a reserved non-household partition key that cannot collide with a household id, and must be recorded here.
