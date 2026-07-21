/**
 * Typed request/response models for the household-model endpoints (H1-H4),
 * mirroring the API's DTOs (ASP.NET serializes them as camelCase JSON). These
 * are the shapes the F7 {@link ApiClient} reads and writes; the onboarding flow
 * (H5) and later capability screens share them instead of re-declaring inline.
 */

/** The resolved organizer returned by the organizer-gated `GET /me` (F6 seam). */
export type MeResponse = {
  subject: string | null;
  name: string | null;
};

/** A household as returned by the Households endpoints (H1). */
export type HouseholdResponse = {
  householdId: string;
  name: string;
  organizerObjectId: string;
  createdUtc: string;
  etag: string;
};

/** Body for `POST /households`. */
export type CreateHouseholdRequest = {
  name: string;
};

/** A room as returned by the Rooms endpoints (H4). */
export type RoomResponse = {
  roomId: string;
  name: string;
  sortOrder: number;
  etag: string;
};

/** Body for `POST /households/{householdId}/rooms`. */
export type CreateRoomRequest = {
  name: string;
  sortOrder: number;
};

/** A person as returned by the People endpoints (H3). */
export type PersonResponse = {
  personId: string;
  displayName: string;
  role: string;
  isChild: boolean;
  claimColor: string | null;
  etag: string;
};

/**
 * One claimable person on the tap-to-claim roster, as returned by the open
 * (unauthenticated) people-list read `GET /households/{householdId}/people`.
 * This is the trimmed projection the hub renders as a name tile: only what a
 * tile needs, never organizer-only data, the role, or the concurrency ETag
 * (the single-person read returns the full {@link PersonResponse}).
 */
export type RosterEntryResponse = {
  personId: string;
  displayName: string;
  claimColor: string | null;
  isChild: boolean;
};

/**
 * The participant session returned by the T1 claim endpoint
 * (`POST /households/{householdId}/people/{personId}/claim`), mirroring the
 * API's `ParticipantSessionResponse` DTO. The hub holds this in UI state to mark
 * the active participant and, later, to attribute completions (the seam Epic 40
 * C4 uses via {@link token}). It is never persisted as a credential and never
 * sent to organizer-policy endpoints - tapping a name never prompts for a
 * password or PIN.
 */
export type ParticipantSessionResponse = {
  householdId: string;
  personId: string;
  displayName: string;
  claimColor: string | null;
  isChild: boolean;
  token: string;
};

/**
 * The pairing result returned by the T5 pair endpoint
 * (`POST /households/{householdId}/hub-devices/pair`), mirroring the API's
 * `HubDevicePairingResponse` DTO. The hub stores {@link token} - a long-lived,
 * household-scoped device credential - for subsequent reads and completion
 * writes. It grants no organizer authority and is minted only from an
 * organizer-gated pair, so it is never obtained on the participant-only path.
 */
export type HubDevicePairingResponse = {
  householdId: string;
  deviceId: string;
  deviceName: string;
  pairedUtc: string;
  token: string;
};

/** Body for `POST /households/{householdId}/hub-devices/pair`. */
export type PairHubDeviceRequest = {
  deviceName: string;
};

/** Body for `POST /households/{householdId}/people`. */
export type CreatePersonRequest = {
  displayName: string;
  role: string;
  isChild: boolean;
  claimColor: string | null;
};

/** A chore as returned by the Chores endpoints (H2). */
export type ChoreResponse = {
  choreId: string;
  title: string;
  roomId: string;
  cadence: string;
  effort: number;
  minAge: number | null;
  active: boolean;
  etag: string;
};

/** Body for `POST /households/{householdId}/chores`. */
export type CreateChoreRequest = {
  title: string;
  roomId: string;
  cadence: string;
  effort: number;
  minAge: number | null;
};

/**
 * One placed chore in an {@link AssignmentSetResponse} (C3): who it went to, its
 * effort, and whether it is still `Open` or was already completed (`Done`). The
 * chore's display title and cadence are not on this projection - the board joins
 * it against the Chores read ({@link ChoreResponse}) to render a human item.
 */
export type AssignmentView = {
  choreId: string;
  assignedPersonId: string;
  effort: number;
  status: string;
};

/** One chore the C2 engine could not place, surfaced with its reason code. */
export type UnassignedView = {
  choreId: string;
  effort: number;
  reason: string;
};

/**
 * The result of generating (or idempotently regenerating) one household week's
 * chore assignments, returned by the C3 endpoint
 * (`POST /households/{householdId}/assignments/generate`). It is the source the
 * hub chore board (C5) reads; a regenerate is deterministic and preserves `Done`,
 * so re-reading it to render the board is safe.
 */
export type AssignmentSetResponse = {
  weekIso: string;
  assignments: AssignmentView[];
  unassigned: UnassignedView[];
};

/**
 * The state of an assignment after a successful tap-to-complete, returned by the
 * C4 endpoint
 * (`POST /households/{householdId}/assignments/{weekIso}/{choreId}/complete`).
 * `Status` is always `Done` on success; a double-complete is an idempotent
 * success (never an error).
 */
export type CompleteChoreResponse = {
  weekIso: string;
  choreId: string;
  assignedPersonId: string;
  status: string;
};

/** Body for the C4 complete endpoint: the acting person (the UI's active participant). */
export type CompleteChoreRequest = {
  personId: string;
};

/**
 * One person's slice of the household contribution balance (C6), mirroring the
 * API's `PersonShare` DTO: their completed effort over the window and that effort
 * as both a fraction (`share`, `0`..`1`) and a percentage (`sharePercent`,
 * `0`..`100`) of the household total. Both are `0` when the household total is `0`.
 */
export type PersonShare = {
  personId: string;
  displayName: string;
  totalEffort: number;
  share: number;
  sharePercent: number;
};

/**
 * The household's contribution balance over a trailing ISO-week window, returned
 * by the C6 endpoint (`GET /households/{householdId}/fairness`). It is a
 * read-only aggregate over the completions ledger - the Section 10 fairness
 * guardrail - carrying the window it was computed over, the household total, the
 * top contributor, and each person's share (ordered by effort descending).
 */
export type FairnessResponse = {
  windowStartWeekIso: string;
  windowEndWeekIso: string;
  windowWeeks: number;
  totalEffort: number;
  topContributorPersonId: string | null;
  shares: PersonShare[];
};
