/**
 * Hub glance usage events (#122).
 *
 * When the hub is on screen it tells the API it was looked at, by posting a
 * `hub-glanced` event to `POST /households/{id}/events`. Every other usage event
 * (completions, undos, cart adds, confirms, claims) is recorded server-side by
 * the API itself, so this is the only event the UI ever posts.
 *
 * The rules:
 *
 * - **At most once per hub device per 10 minutes.** The last report is stamped
 *   per household in {@link sessionFallbackStorage}, so the debounce survives a
 *   reload where Web Storage exists and still holds for the session where it
 *   does not. The stamp is written *before* posting, so an API that keeps
 *   failing is not hammered on every visibility change.
 * - **Online, the post goes straight to the API, not through the write queue.**
 *   A write that drains through the queue bumps `confirmedRevision`, which
 *   flashes "All synced." and refetches the board. A glance every 10 minutes
 *   must do neither.
 * - **Offline, it is queued.** Only a `network` error (the API is unreachable)
 *   enqueues the glance on the existing write queue, which replays it on
 *   reconnect. Any other refusal (401 on an unpaired hub, 400, 404) is dropped:
 *   retrying a request the API has answered would never succeed.
 *
 * Pure apart from the storage seam and the injected client, so every branch is
 * testable without React.
 */

import type { ApiClient } from '../api/client';
import { sessionFallbackStorage, type LocalStorageLike } from './storage';
import type { WriteRequest } from './writeQueue';

/** The debounce window: one glance per hub device per 10 minutes. */
export const GLANCE_INTERVAL_MS = 10 * 60 * 1000;

/** The one event type the UI posts. */
export const HUB_GLANCED_EVENT = 'hub-glanced';

/**
 * Key prefix for the per-household debounce stamp. Distinct from
 * `butler.glance.v1.`, which is the O2 last-known board cache.
 */
export const HUB_GLANCED_PREFIX = 'butler.hubglanced.v1.';

/** Storage key for a household's last-glance stamp. */
export function hubGlancedKey(householdId: string): string {
  return `${HUB_GLANCED_PREFIX}${householdId}`;
}

/** When this device last reported a glance for the household (epoch ms), or `null`. */
export function readLastGlanceMs(
  householdId: string,
  storage: LocalStorageLike = sessionFallbackStorage(),
): number | null {
  try {
    const raw = storage.getItem(hubGlancedKey(householdId));
    if (raw === null) {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Stamp the household's last glance. A store that refuses the write is ignored. */
export function writeLastGlanceMs(
  householdId: string,
  nowMs: number,
  storage: LocalStorageLike = sessionFallbackStorage(),
): void {
  try {
    storage.setItem(hubGlancedKey(householdId), String(nowMs));
  } catch {
    // A stamp that cannot be stored only means the next glance may report early.
  }
}

/** Whether a glance is due: never reported, or at least 10 minutes ago. */
export function isGlanceDue(lastMs: number | null, nowMs: number): boolean {
  return lastMs === null || nowMs - lastMs >= GLANCE_INTERVAL_MS;
}

/**
 * The write a glance becomes. The dedupe key carries the glance time, so two
 * glances queued during one long outage are two events (each 10 minutes apart),
 * and it is not an assignment key, so the drain never treats it as week-bound.
 */
export function hubGlanceWrite(householdId: string, nowMs: number): WriteRequest {
  return {
    kind: 'hub-glance',
    dedupeKey: `hub-glance|${nowMs}`,
    method: 'POST',
    path: `/households/${householdId}/events`,
    body: { type: HUB_GLANCED_EVENT },
  };
}

/** What one {@link reportHubGlance} call did. */
export type HubGlanceOutcome = 'skipped' | 'posted' | 'queued' | 'dropped';

/**
 * Report a glance if one is due: post it directly, queue it when the API is
 * unreachable, or drop it when the API refused it.
 */
export async function reportHubGlance(
  householdId: string,
  client: ApiClient,
  enqueue: (request: WriteRequest) => void,
  nowMs: number = Date.now(),
  storage: LocalStorageLike = sessionFallbackStorage(),
): Promise<HubGlanceOutcome> {
  if (!isGlanceDue(readLastGlanceMs(householdId, storage), nowMs)) {
    return 'skipped';
  }
  // Stamp first, so a failing API is not asked again until the window passes.
  writeLastGlanceMs(householdId, nowMs, storage);

  const write = hubGlanceWrite(householdId, nowMs);
  const result = await client.update<unknown>(write.path, write.body, { method: write.method });
  if (result.ok) {
    return 'posted';
  }
  if (result.error.kind === 'network') {
    enqueue(write);
    return 'queued';
  }
  return 'dropped';
}
