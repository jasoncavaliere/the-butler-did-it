// Headless check that a demo hub opens the seeded demo household (#316).
//
// `demo up` builds the hub export with EXPO_PUBLIC_DEMO_HOUSEHOLD_ID=demo-household,
// and `demo reset` (#98) seeds that household: "The Parker Household" (Maria,
// Dan, Ava, Leo). With nothing stored in the browser the hub must open it, not
// the setup wizard. This check opens the hub in a fresh browser context (so
// nothing is stored), waits for the hub shell, requires the setup wizard to be
// absent, signs the organizer in on the PIN pad with BUTLER_DEMO_PIN, then waits
// for the hub to show "The Parker Household" and the name "Maria". While it runs
// it records:
//   - every request the page makes whose origin is not the hub's origin,
//   - every console error and uncaught page error,
//   - every request that failed at the network level.
//
// Usage: node demo/ci/check-demo-household.cjs [url]
//   url defaults to http://localhost:8080/.
//   Run it after `demo/demo.sh up` and `demo/demo.sh reset` (reset seeds the
//   household; up alone does not).
// Env:
//   NODE_PATH  - where `playwright` is installed (it is not a repo dependency).
//   PW_CHANNEL - optional browser channel, e.g. "chrome" for desktop Chrome.
//   BUTLER_DEMO_PIN - required: the organizer PIN the API was started with.
//
// Exits 1 unless the flow completed, a same-origin 200 GET
// <hub origin>/api/households/demo-household was made, no household was created
// (no POST .../households), no request left the hub origin, no request failed
// and the console shows zero CORS errors. The 401s an unpaired hub logs before
// the organizer signs in are expected and allowed.
'use strict';

const { chromium } = require('playwright');

const url = process.argv[2] || 'http://localhost:8080/';
const STEP_TIMEOUT_MS = 30000;
const CORS_PATTERN = /CORS|Access-Control-Allow|cross-origin/i;
const DEMO_HOUSEHOLD_ID = 'demo-household';
const DEMO_HOUSEHOLD_NAME = 'The Parker Household';
const DEMO_MEMBER = 'Maria';

async function main() {
  const pin = process.env.BUTLER_DEMO_PIN || '';
  if (!/^[0-9]{4,6}$/.test(pin)) {
    throw new Error('BUTLER_DEMO_PIN must be set to the 4-6 digit organizer PIN.');
  }
  const origin = new URL(url).origin;

  const crossOrigin = [];
  const consoleErrors = [];
  const failedRequests = [];
  const apiCalls = [];
  let setupShown = false;

  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);

    page.on('request', (request) => {
      const requestUrl = request.url();
      if (requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) {
        return;
      }
      const parsed = new URL(requestUrl);
      if (parsed.origin !== origin) {
        crossOrigin.push(`${request.method()} ${requestUrl}`);
      }
    });
    page.on('response', (response) => {
      const request = response.request();
      if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr') {
        apiCalls.push({ method: request.method(), url: response.url(), status: response.status() });
      }
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure();
      const reason = failure ? failure.errorText : 'unknown';
      failedRequests.push(`${request.method()} ${request.url()} (${reason})`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

    const byTestId = (id) => page.locator(`[data-testid="${id}"]`);

    // Any UI step that times out is reported alongside what the page logged.
    let flowError = null;
    try {
      await page.goto(url, { waitUntil: 'load' });

      // The hub shell, not the setup wizard (HouseholdSetup), is the start route.
      await byTestId('hub-shell').waitFor();
      setupShown = (await byTestId('input-household-name').count()) > 0;
      if (setupShown) {
        throw new Error('the setup wizard (input-household-name) is showing');
      }

      // The hub is unpaired, so it reads the household once the organizer signs
      // in on the PIN pad (OrganizerBar).
      await byTestId('organizer-sign-in').click();
      await byTestId('pin-pad').waitFor();
      for (const digit of pin) {
        await byTestId(`pin-digit-${digit}`).click();
      }
      await byTestId('pin-submit').click();

      await byTestId('hub-household-name').filter({ hasText: DEMO_HOUSEHOLD_NAME }).waitFor();
      await page.getByText(DEMO_MEMBER, { exact: true }).first().waitFor();
    } catch (err) {
      flowError = err;
    }

    const sameOriginApi = (call) => call && call.url.startsWith(`${origin}/api/`);
    const demoRead = apiCalls.find(
      (call) =>
        call.method === 'GET' &&
        call.status === 200 &&
        new URL(call.url).pathname === `/api/households/${DEMO_HOUSEHOLD_ID}`,
    );
    const creates = apiCalls.filter(
      (call) => call.method === 'POST' && /\/households\/?$/.test(new URL(call.url).pathname),
    );
    const corsErrors = consoleErrors.filter((text) => CORS_PATTERN.test(text));

    const report = {
      origin,
      householdId: DEMO_HOUSEHOLD_ID,
      householdName: DEMO_HOUSEHOLD_NAME,
      setupShown,
      flowError: flowError ? flowError.message.split('\n')[0] : null,
      demoRead,
      creates,
      apiCalls,
      crossOrigin,
      failedRequests,
      consoleErrors,
      corsErrors: corsErrors.length,
    };
    console.log(JSON.stringify(report, null, 2));

    const problems = [];
    if (flowError) {
      problems.push(`demo household flow did not complete: ${flowError.message.split('\n')[0]}`);
    }
    if (!demoRead || !sameOriginApi(demoRead)) {
      problems.push(`no same-origin 200 GET ${origin}/api/households/${DEMO_HOUSEHOLD_ID}`);
    }
    if (creates.length > 0) {
      problems.push(`the hub created a household: ${creates.map((call) => call.url).join(', ')}`);
    }
    const offOriginApi = apiCalls.filter((call) => !sameOriginApi(call));
    if (offOriginApi.length > 0) {
      const urls = offOriginApi.map((call) => call.url).join(', ');
      problems.push(`API calls not under ${origin}/api/: ${urls}`);
    }
    if (crossOrigin.length > 0) {
      problems.push(`requests left the hub origin: ${crossOrigin.join(', ')}`);
    }
    if (failedRequests.length > 0) {
      problems.push(`requests failed: ${failedRequests.join(', ')}`);
    }
    if (corsErrors.length > 0) {
      problems.push(`console shows ${corsErrors.length} CORS error(s): ${corsErrors.join(' | ')}`);
    }

    if (problems.length > 0) {
      for (const problem of problems) {
        console.error(problem);
      }
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
