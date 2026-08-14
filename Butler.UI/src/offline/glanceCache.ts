/**
 * The last-known-week read cache (Epic 60 O2).
 *
 * BRD 6.5 step 1: "the network drops, the hub still shows the last-known week
 * and today's board." O1 taught the service worker to cache the app shell; this
 * module is the data half. It holds exactly what the daily glance needs - the
 * household and its people (the name tiles), plus the current week's board -
 * under one record per household, so a hub whose API is unreachable renders real
 * tiles and real chores instead of an error.
 *
 * Three properties keep it honest:
 * - it is a *read* cache. Nothing here touches the write path; an offline tap is
 *   the write queue's business ({@link ../offline/writeQueue}, O3), which
 *   persists separately through the same storage seam.
 * - it never looks live. Every record carries a `cachedAtIso` freshness stamp
 *   that the caller surfaces as a visible "showing last-known" indication.
 * - it never crosses households. The record is keyed by `householdId` *and*
 *   carries its own, which is verified on read - so a stale entry from another
 *   household reads as no cache rather than as someone else's chores.
 *
 * Every failure mode is a no-op: no storage (native, or a browser with it
 * blocked), a missing entry, an unparseable or wrong-shaped entry, or a quota
 * error on write all degrade to "no cache", which drops the caller back onto its
 * normal empty/error path. The cache can never crash a render.
 */

import type { RosterEntryResponse } from '../api/models';
import { defaultLocalStorage, isRecord, type LocalStorageLike } from './storage';

/** One rendered board row, cached exactly as the board draws it. */
export type CachedBoardItem = {
  choreId: string;
  title: string;
  cadence: string;
  assignedPersonId: string;
  status: 'Open' | 'Done';
};

/** The household half of the glance: the header name and the claimable roster. */
export type CachedHousehold = {
  name: string;
  people: RosterEntryResponse[];
};

/** The board half of the glance: the current week and its assignments. */
export type CachedBoard = {
  weekIso: string;
  items: CachedBoardItem[];
};

/**
 * One household's cached glance. The two halves are written independently (the
 * shell loads the household, the board loads the week) and are each nullable, so
 * a half-populated record still serves what it has.
 */
export type GlanceSnapshot = {
  householdId: string;
  household: CachedHousehold | null;
  board: CachedBoard | null;
  /** When this record was last refreshed from live data (ISO 8601). */
  cachedAtIso: string;
};

/**
 * The subset of the Web Storage API this cache uses. It is the shared
 * {@link LocalStorageLike} seam - the O3 write queue persists through the same
 * one - kept under this name so O2's callers and tests keep their vocabulary.
 */
export type GlanceStorage = LocalStorageLike;

/** What a single write may replace; the untouched half is carried forward. */
export type GlancePatch = {
  household?: CachedHousehold;
  board?: CachedBoard;
};

/**
 * Key prefix. The `v1` segment is the schema version: bumping it retires every
 * old record at once rather than trying to migrate a cache that can simply be
 * refetched.
 */
export const GLANCE_CACHE_PREFIX = 'butler.glance.v1.';

/** Storage key for a household's glance record. */
export function glanceCacheKey(householdId: string): string {
  return `${GLANCE_CACHE_PREFIX}${householdId}`;
}

/**
 * The ambient browser storage, feature-detected (and guarded against a blocked
 * store) in {@link ../offline/storage}: on native, and in a browser with storage
 * denied, there is simply none, so the cache no-ops without a `Platform.OS`
 * branch. Re-exported under this name because it *is* O2's storage default.
 */
export { defaultLocalStorage as defaultGlanceStorage };

/**
 * Validate the household half. Every field the name tiles actually read is
 * checked, because the alternative is a malformed entry reaching `.map()` and
 * throwing inside a render - the one thing this cache must never do. A half that
 * does not validate is returned as `null`, i.e. "not cached", which drops that
 * region back onto its normal empty/error path while the other half still serves.
 */
function parseHousehold(value: unknown): CachedHousehold | null {
  if (!isRecord(value) || typeof value.name !== 'string' || !Array.isArray(value.people)) {
    return null;
  }
  const people: RosterEntryResponse[] = [];
  for (const person of value.people) {
    if (
      !isRecord(person) ||
      typeof person.personId !== 'string' ||
      typeof person.displayName !== 'string'
    ) {
      return null;
    }
    people.push(person as unknown as RosterEntryResponse);
  }
  return { name: value.name, people };
}

/** Validate the board half, field by field, for the same reason as above. */
function parseBoard(value: unknown): CachedBoard | null {
  if (!isRecord(value) || typeof value.weekIso !== 'string' || !Array.isArray(value.items)) {
    return null;
  }
  const items: CachedBoardItem[] = [];
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      typeof item.choreId !== 'string' ||
      typeof item.title !== 'string' ||
      typeof item.cadence !== 'string' ||
      typeof item.assignedPersonId !== 'string' ||
      (item.status !== 'Open' && item.status !== 'Done')
    ) {
      return null;
    }
    items.push({
      choreId: item.choreId,
      title: item.title,
      cadence: item.cadence,
      assignedPersonId: item.assignedPersonId,
      status: item.status,
    });
  }
  return { weekIso: value.weekIso, items };
}

/**
 * Rebuild a trustworthy snapshot from a parsed entry, or `null` when the entry
 * cannot be identified at all (no household id, no freshness stamp - there is
 * nothing to key it to or to date it by, so the whole record goes).
 */
function parseSnapshot(value: unknown): GlanceSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.householdId !== 'string' || typeof value.cachedAtIso !== 'string') {
    return null;
  }
  return {
    householdId: value.householdId,
    household: parseHousehold(value.household),
    board: parseBoard(value.board),
    cachedAtIso: value.cachedAtIso,
  };
}

/**
 * Read the cached glance for `householdId`, or `null` when there is nothing
 * trustworthy to show: no storage, no entry, an unreadable or unparseable entry,
 * a wrong-shaped one, or - the cross-household guard - one whose own
 * `householdId` is not the household being rendered.
 *
 * What comes back is rebuilt field by field, not merely cast: a half whose shape
 * does not validate comes back as `null` (that region falls through to its normal
 * empty/error path) rather than as junk that would throw inside a render. Storage
 * is a shared, hand-editable, version-skewing place, so nothing in it is trusted.
 */
export function readGlance(
  householdId: string,
  storage: GlanceStorage | undefined = defaultLocalStorage(),
): GlanceSnapshot | null {
  if (!storage) {
    return null;
  }

  let raw: string | null;
  try {
    raw = storage.getItem(glanceCacheKey(householdId));
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const snapshot = parseSnapshot(parsed);
  if (snapshot === null || snapshot.householdId !== householdId) {
    return null;
  }
  return snapshot;
}

/**
 * Merge `patch` into the household's cached glance and re-stamp its freshness,
 * returning the stored snapshot (or `null` when nothing could be stored). Called
 * on every successful load, so the record and its timestamp are always as fresh
 * as the last time the API answered.
 *
 * A merge (rather than a replace) is what lets the shell and the board cache
 * their halves independently without either erasing the other. A storage failure
 * - quota, a private-mode browser, a disabled store - is swallowed: failing to
 * cache must never break a load that actually succeeded.
 */
export function writeGlance(
  householdId: string,
  patch: GlancePatch,
  storage: GlanceStorage | undefined = defaultLocalStorage(),
  nowIso: string = new Date().toISOString(),
): GlanceSnapshot | null {
  if (!storage) {
    return null;
  }

  const existing = readGlance(householdId, storage);
  const next: GlanceSnapshot = {
    householdId,
    household: patch.household ?? existing?.household ?? null,
    board: patch.board ?? existing?.board ?? null,
    cachedAtIso: nowIso,
  };

  try {
    storage.setItem(glanceCacheKey(householdId), JSON.stringify(next));
  } catch {
    return null;
  }
  return next;
}

/** Plural suffix for a whole-number count ("1 minute", "2 minutes"). */
function plural(count: number): string {
  return count === 1 ? '' : 's';
}

/** How long ago the cache was written, in locale-free, glanceable words. */
function describeElapsed(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return 'moments ago';
  }
  if (minutes < 60) {
    return `${minutes} minute${plural(minutes)} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${plural(hours)} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${plural(days)} ago`;
}

/**
 * The user-facing last-known line, derived from the freshness stamp. Relative
 * wording (rather than a formatted date) keeps it readable from across the
 * kitchen and free of locale/timezone surprises on the shared tablet. An
 * unparseable stamp still says the view is last-known - it just cannot say how
 * old it is, which is better than claiming a false age.
 */
export function describeLastKnown(cachedAtIso: string, nowMs: number = Date.now()): string {
  const cachedMs = Date.parse(cachedAtIso);
  if (Number.isNaN(cachedMs)) {
    return 'Showing last-known';
  }
  return `Showing last-known - saved ${describeElapsed(Math.max(0, nowMs - cachedMs))}`;
}
