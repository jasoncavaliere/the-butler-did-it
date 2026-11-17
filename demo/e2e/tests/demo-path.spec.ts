// The demo path, end to end in a headless browser (#121), run by demo verify
// against the stack demo up started and demo reset seeded.
//
// The tests share one browser page and run in order, as a presenter would:
// pair the hub, claim a name, tick a chore, glance at fairness, add to the
// cart, confirm it as the organizer, then lose and regain the network. A
// failed step stops the rest (serial mode), and the global teardown resets
// the stack either way.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  HOUSEHOLD_ID,
  HOUSEHOLD_NAME,
  HUB_URL,
  MEMBERS,
  VIEWPORT,
  choreWritePath,
  claim,
  nameTile,
  nameTiles,
  pickOpenChore,
  signInOrganizer,
  tileLooksClaimed,
  waitForApi,
} from '../hub';

// Not in the seeded cart, and resolves to exactly one catalog product.
const TYPED_ITEM = 'oat milk';
const TYPED_PRODUCT = 'H-E-B Oat Milk';

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  // A context made by hand does not inherit the config's use block, so the
  // base URL and viewport are passed again here.
  context = await browser.newContext({ baseURL: HUB_URL, viewport: VIEWPORT, serviceWorkers: 'allow' });
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

// The built-in failure screenshot covers only the fixture page, so attach one
// of the shared page.
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && page && !page.isClosed()) {
    const body = await page.screenshot({ fullPage: true }).catch(() => null);
    if (body) {
      await testInfo.attach('hub', { body, contentType: 'image/png' });
    }
  }
});

test('setup: the hub opens the Parker household and the organizer pairs it', async () => {
  await page.goto('/');
  await expect(page.getByTestId('hub-shell')).toBeVisible();

  // An unpaired hub reads nothing until the organizer signs in (#105, #316).
  await signInOrganizer(page);
  await expect(page.getByTestId('hub-household-name')).toContainText(HOUSEHOLD_NAME);
  await expect(nameTiles(page)).toHaveCount(MEMBERS.length);

  // Pairing lets the hub keep reading as a device after the organizer signs
  // out and after a reload, which the offline steps need.
  await page.getByTestId('hub-pairing-button').click();
  await expect(page.getByTestId('hub-pairing-button')).toContainText('Tablet paired');

  // The service worker must control the page before it can serve it offline.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null);

  await page.getByTestId('organizer-sign-out').click();
  await expect(page.getByTestId('organizer-sign-in')).toBeVisible();
  await expect(nameTiles(page)).toHaveCount(MEMBERS.length);
  for (const name of MEMBERS) {
    await expect(nameTile(page, name)).toBeVisible();
  }
});

test('hub: the browser viewport is 1280x800', async () => {
  expect(page.viewportSize()).toEqual(VIEWPORT);
  const inner = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  expect(inner).toEqual([VIEWPORT.width, VIEWPORT.height]);
});

test('hub: tapping a name shows that participant as claimed', async () => {
  const tile = nameTile(page, 'Maria');
  expect(await tileLooksClaimed(tile), 'Maria is not claimed before the tap').toBe(false);

  const personId = await claim(page, 'Maria');
  expect(await tileLooksClaimed(tile)).toBe(true);

  // The today panel is now hers, and the board focuses on her: every person
  // group on it is hers. Fair assignment may give the top contributor nothing
  // this week, so an empty board ("Nothing on your list") also passes.
  await expect(page.getByTestId('today-panel')).toContainText("Maria's day");
  await expect(page.getByTestId('chore-board-loading')).toHaveCount(0);
  const groups = page.locator('[data-testid^="chore-board-person-"]');
  await expect(groups.or(page.getByTestId('chore-board-empty')).first()).toBeVisible();
  const ids = await groups.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')));
  for (const id of ids) {
    expect(id).toMatch(new RegExp(`-${personId}$`));
  }
});

test('chores: tapping an Open chore marks it Done, tapping again reopens it', async () => {
  // Re-claim: the hub's 45 s idle timer clears the participant otherwise.
  await claim(page, 'Maria');
  const { choreId } = await pickOpenChore(page, 'Maria');
  const item = page.getByTestId(`chore-item-${choreId}`);
  const mark = page.getByTestId(`chore-item-mark-${choreId}`);

  // Wait for each write before the next tap on the same chore.
  const completed = waitForApi(page, 'POST', choreWritePath(choreId, 'complete'));
  await item.click();
  const completeResponse = await completed;
  expect(completeResponse.ok(), `complete returned ${completeResponse.status()}`).toBe(true);
  await expect(mark).toHaveText('✓');

  const undone = waitForApi(page, 'POST', choreWritePath(choreId, 'undo'));
  await item.click();
  const undoResponse = await undone;
  expect(undoResponse.ok(), `undo returned ${undoResponse.status()}`).toBe(true);
  await expect(mark).toHaveText('○');
});

test('fairness: the contribution balance renders its bars', async () => {
  const view = page.getByTestId('fairness-view');
  await expect(view).toBeVisible();
  await expect(page.getByTestId('fairness-loading')).toHaveCount(0);
  await expect(page.getByTestId('fairness-error')).toHaveCount(0);

  const bars = page.getByTestId(/^fairness-bar-/);
  await expect.poll(() => bars.count()).toBeGreaterThan(0);
  const widths = await bars.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  expect(Math.max(...widths), 'at least one fairness bar has a width').toBeGreaterThan(0);
});

test('grocery: a typed item appears in the cart', async () => {
  // Adding is attributed to the active participant.
  await claim(page, 'Maria');
  const list = page.getByTestId('grocery-cart-list');
  await expect(list).toBeVisible();
  await expect(list).not.toContainText(TYPED_PRODUCT);

  await page.getByTestId('grocery-add-input').fill(TYPED_ITEM);
  const captured = waitForApi(page, 'POST', new RegExp(`^/api/households/${HOUSEHOLD_ID}/capture/text$`));
  await page.getByTestId('grocery-add-submit').click();
  const response = await captured;
  expect(response.ok(), `capture returned ${response.status()}`).toBe(true);
  await expect(list).toContainText(TYPED_PRODUCT);
});

test('organizer: PIN sign-in, confirm the cart, see the receipt', async () => {
  await signInOrganizer(page);
  await expect(page.getByTestId('organizer-identity')).toBeVisible();

  // The organizer bar's Confirm order only brings the cart's button into view.
  await page.getByTestId('affordance-confirm-order').click();
  const confirmButton = page.getByTestId('grocery-confirm');
  await expect(confirmButton).toBeVisible();
  const confirmed = waitForApi(page, 'POST', new RegExp(`^/api/households/${HOUSEHOLD_ID}/carts/[^/]+/confirm$`));
  await confirmButton.click();
  const response = await confirmed;
  expect(response.ok(), `confirm returned ${response.status()}`).toBe(true);

  const receipt = page.getByTestId('order-receipt');
  await expect(receipt).toBeVisible();
  await expect(page.getByTestId('order-receipt-heading')).toBeVisible();
  await expect(receipt).toContainText(TYPED_PRODUCT);

  await page.getByTestId('order-receipt-dismiss').click();
  await expect(page.getByTestId('hub-shell')).toBeVisible();
  await expect(page.getByTestId('grocery-cart-week-confirmed')).toBeVisible();
});

test('offline: a reload shows the last-known board', async () => {
  // The board was read online, so its week is cached. A participant left
  // claimed with nothing this week sees the empty state instead of the board.
  await expect(page.getByTestId('chore-board-loading')).toHaveCount(0);
  await expect(page.getByTestId('chore-board').or(page.getByTestId('chore-board-empty')).first()).toBeVisible();
  await expect(page.getByTestId('last-known-banner')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller != null)).toBe(true);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });

  await expect(page.getByTestId('hub-shell')).toBeVisible();
  await expect(page.getByTestId('last-known-banner')).toBeVisible();
  await expect(page.getByTestId('chore-board')).toBeVisible();
  await expect.poll(() => page.getByTestId(/^chore-item-mark-/).count()).toBeGreaterThan(0);
  await expect(nameTiles(page)).toHaveCount(MEMBERS.length);
  // Proves the page really lost the network.
  await expect(page.getByTestId('sync-indicator-connection')).toContainText('Offline');
});

test('offline: a chore completed offline syncs on reconnect', async () => {
  // Back online, the hub reloads itself and drops the last-known banner.
  await context.setOffline(false);
  await expect(page.getByTestId('last-known-banner')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('sync-indicator-connection')).toContainText('Online', { timeout: 30_000 });

  // A claim needs the API, so claim online, then go offline without a reload.
  await claim(page, 'Maria');
  const { choreId } = await pickOpenChore(page, 'Maria');
  const mark = page.getByTestId(`chore-item-mark-${choreId}`);

  await context.setOffline(true);
  await expect(page.getByTestId('sync-indicator-connection')).toContainText('Offline');
  await page.getByTestId(`chore-item-${choreId}`).click();
  await expect(mark).toHaveText('✓');
  await expect(page.getByTestId('sync-indicator-pending')).toContainText('waiting to sync');

  const replayed = waitForApi(page, 'POST', choreWritePath(choreId, 'complete'), 30_000);
  await context.setOffline(false);
  const response = await replayed;
  expect(response.ok(), `the queued complete returned ${response.status()}`).toBe(true);
  await expect(page.getByTestId('sync-indicator-pending')).toHaveCount(0, { timeout: 30_000 });

  await page.reload({ waitUntil: 'load' });
  await expect(page.getByTestId('hub-shell')).toBeVisible();
  await expect(page.getByTestId('chore-board')).toBeVisible();
  await expect(page.getByTestId('last-known-banner')).toHaveCount(0);
  await expect(mark).toHaveText('✓');
});

