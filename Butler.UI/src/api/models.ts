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
