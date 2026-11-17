// Shared settings and helpers for the demo-path browser suite (#121).
//
// Everything is located by data-testid: react-native-web turns each testID
// into a data-testid attribute, so page.getByTestId works with no config.
// Person and chore ids are read from those attributes at run time, never
// hard-coded, because demo reset may give them new values.
import { expect, test, type Locator, type Page, type Response } from '@playwright/test';

/** The hub that demo up serves (Caddy, same origin as the API under /api). */
export const HUB_URL = 'http://localhost:8080';

/** The landscape tablet size the demo is built for (AC10). */
export const VIEWPORT = { width: 1280, height: 800 };

/** The household demo reset seeds and the export opens on a fresh browser (#316). */
export const HOUSEHOLD_ID = 'demo-household';
export const HOUSEHOLD_NAME = 'The Parker Household';

/** The seeded members, in roster order. */
export const MEMBERS = ['Maria', 'Dan', 'Ava', 'Leo'] as const;

const PIN_PATTERN = /^[0-9]{4,6}$/;

/**
 * The organizer PIN (#105). demo verify passes it in BUTLER_DEMO_PIN; it is
 * never in argv and never printed.
 */
export function demoPin(): string {
  const pin = process.env.BUTLER_DEMO_PIN ?? '';
  if (!PIN_PATTERN.test(pin)) {
    throw new Error('BUTLER_DEMO_PIN must be set to the 4-6 digit organizer PIN.');
  }
  return pin;
}

/**
 * Waits for the response to a same-origin API call, matched on the request
 * method and the URL path (the hub calls the API through Caddy, so paths read
 * /api/households/demo-household/...). Register it before the action that
 * sends the request.
 */
export function waitForApi(page: Page, method: string, path: RegExp, timeout?: number): Promise<Response> {
  return page.waitForResponse(
    (response) => response.request().method() === method && path.test(new URL(response.url()).pathname),
    timeout === undefined ? undefined : { timeout },
  );
}

/**
 * Signs the organizer in on the hub's PIN pad. One attempt only: five wrong
 * PINs lock sign-in for a minute, so this never retries with another PIN.
 */
export async function signInOrganizer(page: Page): Promise<void> {
  const pin = demoPin();
  await test.step(
    'enter the organizer PIN',
    async () => {
      await page.getByTestId('organizer-sign-in').click();
      await expect(page.getByTestId('pin-pad')).toBeVisible();
      for (const digit of pin) {
        await page.getByTestId(`pin-digit-${digit}`).click();
      }
      await page.getByTestId('pin-submit').click();
      await expect(page.getByTestId('organizer-identity')).toBeVisible();
    },
    { box: true },
  );
}

/** Every name tile on the hub. */
export function nameTiles(page: Page): Locator {
  return page.getByTestId(/^name-tile-/);
}

/** The name tile showing `name`. */
export function nameTile(page: Page, name: string): Locator {
  return nameTiles(page).filter({ hasText: name });
}

/** The id in a `<prefix><id>` data-testid. */
export async function idFromTestId(locator: Locator, prefix: string): Promise<string> {
  const testId = await locator.getAttribute('data-testid');
  if (testId === null || !testId.startsWith(prefix)) {
    throw new Error(`expected a data-testid starting with ${prefix}, got ${testId}`);
  }
  return testId.slice(prefix.length);
}

/**
 * Whether a name tile shows its person as claimed. The DOM carries no ARIA
 * state (react-native-web drops accessibilityState), so this reads the look:
 * an idle tile is a card with a claim-colour border, a claimed tile is filled
 * with that colour (HubShell.tsx NameTile).
 */
export async function tileLooksClaimed(tile: Locator): Promise<boolean> {
  return tile.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.backgroundColor === style.borderTopColor;
  });
}

/**
 * Taps `name`'s tile, waits for the claim to succeed and for the tile to show
 * as claimed, and returns that person's id. Tapping the active tile again
 * re-claims, which also re-arms the hub's 45 s idle timer.
 */
export async function claim(page: Page, name: string): Promise<string> {
  const tile = nameTile(page, name);
  await expect(tile).toHaveCount(1);
  const personId = await idFromTestId(tile, 'name-tile-');
  const claimed = waitForApi(
    page,
    'POST',
    new RegExp(`^/api/households/${HOUSEHOLD_ID}/people/${escapeRegExp(personId)}/claim$`),
  );
  await tile.click();
  const response = await claimed;
  expect(response.ok(), `claim ${name} returned ${response.status()}`).toBe(true);
  await expect.poll(() => tileLooksClaimed(tile), { message: `${name}'s tile shows as claimed` }).toBe(true);
  return personId;
}

/** A chore on the board, picked by {@link pickOpenChore}. */
export type OpenChore = { choreId: string; person: string };

/**
 * Finds an Open chore for the claimed participant (the board shows only their
 * chores). When `name` has none open, claims the next member in roster order
 * and looks again; fails only when nobody has one.
 */
export async function pickOpenChore(page: Page, name: string): Promise<OpenChore> {
  const start = MEMBERS.indexOf(name as (typeof MEMBERS)[number]);
  const order = start < 0 ? [name, ...MEMBERS] : [...MEMBERS.slice(start), ...MEMBERS.slice(0, start)];
  for (let index = 0; index < order.length; index += 1) {
    const person = order[index];
    if (index > 0) {
      await claim(page, person);
    }
    // A participant with nothing this week gets the empty state, not a board.
    await expect(page.getByTestId('chore-board-loading')).toHaveCount(0);
    await expect(page.getByTestId('chore-board').or(page.getByTestId('chore-board-empty')).first()).toBeVisible();
    const open = page.getByTestId(/^chore-item-mark-/).filter({ hasText: '○' });
    if ((await open.count()) > 0) {
      const choreId = await idFromTestId(open.first(), 'chore-item-mark-');
      return { choreId, person };
    }
  }
  throw new Error('no member has an Open chore on the board this week');
}

/** The path of a chore's complete or undo call for any week. */
export function choreWritePath(choreId: string, verb: 'complete' | 'undo'): RegExp {
  return new RegExp(`^/api/households/${HOUSEHOLD_ID}/assignments/[^/]+/${escapeRegExp(choreId)}/${verb}$`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
