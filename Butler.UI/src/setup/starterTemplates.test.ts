import {
  STARTER_CATALOG,
  matchTemplateRoom,
  templatesForRoom,
  toCreateChoreRequest,
  type StarterCatalog,
} from './starterTemplates';

const allTemplates = STARTER_CATALOG.rooms.flatMap((room) => room.templates);

describe('starter catalog', () => {
  it('is versioned and has 25 to 35 templates, each with room, title, cadence, effort and minAge', () => {
    expect(Number.isInteger(STARTER_CATALOG.version)).toBe(true);
    expect(STARTER_CATALOG.version).toBeGreaterThanOrEqual(1);

    expect(allTemplates.length).toBeGreaterThanOrEqual(25);
    expect(allTemplates.length).toBeLessThanOrEqual(35);

    for (const room of STARTER_CATALOG.rooms) {
      expect(room.id).toEqual(expect.any(String));
      expect(room.name.trim()).not.toBe('');
      expect(Array.isArray(room.aliases)).toBe(true);
      expect(room.templates.length).toBeGreaterThan(0);
      for (const template of room.templates) {
        expect(Object.keys(template).sort()).toEqual([
          'cadence',
          'effort',
          'id',
          'minAge',
          'title',
        ]);
        expect(template.id.startsWith(`${room.id}-`)).toBe(true);
        expect(template.title.trim()).not.toBe('');
        if (template.minAge !== null) {
          expect(Number.isInteger(template.minAge)).toBe(true);
          expect(template.minAge).toBeGreaterThan(0);
        }
      }
    }

    const ids = allTemplates.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every template cadence is Daily or Weekly with effort > 0', () => {
    for (const template of allTemplates) {
      expect(['Daily', 'Weekly']).toContain(template.cadence);
      expect(Number.isInteger(template.effort)).toBe(true);
      expect(template.effort).toBeGreaterThan(0);
    }
  });

  it('keeps room names and aliases unique across rooms and plain ASCII throughout', () => {
    const names = STARTER_CATALOG.rooms.flatMap((room) =>
      [room.name, ...room.aliases].map((n) => n.trim().toLowerCase()),
    );
    expect(new Set(names).size).toBe(names.length);
    // eslint-disable-next-line no-control-regex
    expect(JSON.stringify(STARTER_CATALOG)).toMatch(/^[\x00-\x7F]*$/);
  });

  it('leaves kid-friendly chores open to children (minAge null) for most templates', () => {
    const open = allTemplates.filter((template) => template.minAge === null);
    expect(open.length).toBeGreaterThan(allTemplates.length / 2);
  });
});

describe('templatesForRoom', () => {
  it('matches a room by name case-insensitively', () => {
    const kitchen = STARTER_CATALOG.rooms.find((room) => room.id === 'kitchen')!;
    expect(templatesForRoom('  kitchen ')).toBe(kitchen.templates);
    expect(templatesForRoom('KITCHEN')).toBe(kitchen.templates);
    expect(matchTemplateRoom('Living Room')?.id).toBe('living-room');
  });

  it('matches a room by alias', () => {
    const bathroom = STARTER_CATALOG.rooms.find((room) => room.id === 'bathroom')!;
    expect(templatesForRoom('Bath')).toBe(bathroom.templates);
    expect(matchTemplateRoom('Powder Room')?.id).toBe('bathroom');
    expect(matchTemplateRoom('mudroom')?.id).toBe('entryway');
  });

  it('returns no templates for an unmatched room', () => {
    expect(templatesForRoom('Den')).toEqual([]);
    expect(templatesForRoom('Office')).toEqual([]);
    expect(templatesForRoom('Study')).toEqual([]);
    // Exact match only: no substring matching.
    expect(templatesForRoom('Kids Bathroom')).toEqual([]);
    expect(templatesForRoom('')).toEqual([]);
    expect(matchTemplateRoom('   ')).toBeNull();
  });

  it('accepts a catalog override and lets the first matching room win', () => {
    const catalog: StarterCatalog = {
      version: 7,
      rooms: [
        {
          id: 'a',
          name: 'Nook',
          aliases: ['Corner'],
          templates: [
            {
              id: 'a-1',
              title: 'Fluff pillows',
              cadence: 'Daily',
              effort: 1,
              minAge: null,
            },
          ],
        },
        {
          id: 'b',
          name: 'Corner',
          aliases: [],
          templates: [
            {
              id: 'b-1',
              title: 'Never chosen',
              cadence: 'Weekly',
              effort: 1,
              minAge: null,
            },
          ],
        },
      ],
    };
    expect(matchTemplateRoom('corner', catalog)?.id).toBe('a');
    expect(templatesForRoom('NOOK', catalog).map((t) => t.id)).toEqual(['a-1']);
    expect(templatesForRoom('Kitchen', catalog)).toEqual([]);
  });
});

describe('toCreateChoreRequest', () => {
  it('maps a template and room id to the exact chore payload', () => {
    expect(
      toCreateChoreRequest(
        {
          id: 'kitchen-fridge',
          title: 'Clean out the fridge',
          cadence: 'Weekly',
          effort: 3,
          minAge: 12,
        },
        'room-7',
      ),
    ).toStrictEqual({
      title: 'Clean out the fridge',
      roomId: 'room-7',
      cadence: 'Weekly',
      effort: 3,
      minAge: 12,
    });
    expect(
      toCreateChoreRequest(
        {
          id: 'kitchen-counters',
          title: 'Wipe the counters',
          cadence: 'Daily',
          effort: 1,
          minAge: null,
        },
        'room-1',
      ),
    ).toStrictEqual({
      title: 'Wipe the counters',
      roomId: 'room-1',
      cadence: 'Daily',
      effort: 1,
      minAge: null,
    });
  });
});
