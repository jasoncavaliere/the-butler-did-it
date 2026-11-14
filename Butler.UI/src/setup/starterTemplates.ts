import catalogJson from './starterChoreTemplates.json';
import type { CreateChoreRequest } from '../api/models';

/** The chore recurrence values the API accepts (`ChoreService.NormalizeCadence`). */
export type StarterCadence = 'Daily' | 'Weekly';

/** One suggested chore in the starter catalog. */
export type StarterTemplate = {
  /** Globally unique template id, prefixed with its room id. */
  id: string;
  title: string;
  cadence: StarterCadence;
  /** Positive whole number (the API rejects effort <= 0). */
  effort: number;
  /** Null means anyone (children included) can be assigned it. */
  minAge: number | null;
};

/** A catalog room: the name and aliases a created room is matched against. */
export type StarterTemplateRoom = {
  id: string;
  name: string;
  aliases: string[];
  templates: StarterTemplate[];
};

/** The versioned starter-chore catalog; bump `version` whenever its content changes. */
export type StarterCatalog = {
  version: number;
  rooms: StarterTemplateRoom[];
};

/**
 * The bundled starter-chore catalog (#111). Its validity (cadence, effort, minAge,
 * unique ids) is proven by the fixture test rather than a runtime parser.
 */
export const STARTER_CATALOG: StarterCatalog = catalogJson as StarterCatalog;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The catalog room a created room's name matches: exact, case-insensitive and
 * trimmed equality on the catalog room's name or any of its aliases (no
 * substring or fuzzy matching). The first matching catalog room wins; an empty
 * name or no match returns null.
 */
export function matchTemplateRoom(
  roomName: string,
  catalog: StarterCatalog = STARTER_CATALOG,
): StarterTemplateRoom | null {
  const target = normalize(roomName);
  if (!target) {
    return null;
  }
  return (
    catalog.rooms.find(
      (room) =>
        normalize(room.name) === target ||
        room.aliases.some((alias) => normalize(alias) === target),
    ) ?? null
  );
}

/** The starter templates for a created room's name, in catalog order ([] when unmatched). */
export function templatesForRoom(
  roomName: string,
  catalog: StarterCatalog = STARTER_CATALOG,
): StarterTemplate[] {
  return matchTemplateRoom(roomName, catalog)?.templates ?? [];
}

/** The `POST /households/{id}/chores` body that creates `template` in the given room. */
export function toCreateChoreRequest(
  template: StarterTemplate,
  roomId: string,
): CreateChoreRequest {
  return {
    title: template.title,
    roomId,
    cadence: template.cadence,
    effort: template.effort,
    minAge: template.minAge,
  };
}
