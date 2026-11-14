// Headless end-to-end check that the hub on :8080 talks to the API same-origin
// (#96 AC8).
//
// Opens the hub, drives the organizer onboarding UI (create a household, add a
// room, finish setup) and waits for the hub shell to read the household back
// (GET /households/{id}) and show its name. While it runs it records:
//   - every request the page makes whose origin is not the hub's origin,
//   - every console error and uncaught page error,
//   - every request that failed at the network level.
//
// Usage: node demo/ci/check-household-flow.cjs [url]
//   url defaults to http://localhost:8080/.
// Env:
//   NODE_PATH  - where `playwright` is installed (it is not a repo dependency).
//   PW_CHANNEL - optional browser channel, e.g. "chrome" for desktop Chrome.
//
// Exits 1 unless the household create (POST) and readback (GET) both went to
// <hub origin>/api/households..., every API call was same-origin, no request
// left the hub origin, and the console shows zero CORS errors.
'use strict';

const { chromium } = require('playwright');

const url = process.argv[2] || 'http://localhost:8080/';
const STEP_TIMEOUT_MS = 30000;
const CORS_PATTERN = /CORS|Access-Control-Allow|cross-origin/i;

async function main() {
  const origin = new URL(url).origin;
  const householdName = `Demo CI UI Household ${Date.now()}`;

  const crossOrigin = [];
  const consoleErrors = [];
  const failedRequests = [];
  const apiCalls = [];

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

    // Any UI step that times out is reported alongside what the page logged,
    // so a CORS failure shows up as its console error, not just a timeout.
    let flowError = null;
    try {
      await page.goto(url, { waitUntil: 'load' });

      // Create the household (POST /households) through the onboarding UI.
      await byTestId('input-household-name').fill(householdName);
      await byTestId('submit-household').click();
      await byTestId('step-rooms').waitFor();

      // A room is required before setup can continue.
      await byTestId('input-room-name').fill('Kitchen');
      await byTestId('add-room').click();
      await page.locator('[data-testid^="room-item-"]').first().waitFor();
      await byTestId('continue-rooms').click();
      await byTestId('step-people').waitFor();
      await byTestId('continue-people').click();
      await byTestId('step-chores').waitFor();
      await byTestId('finish-setup').click();

      // The hub shell reads the household back (GET /households/{id}) and shows it.
      const nameHeading = byTestId('hub-household-name');
      await nameHeading.filter({ hasText: householdName }).waitFor();
    } catch (err) {
      flowError = err;
    }

    const create = apiCalls.find(
      (call) => call.method === 'POST' && /\/households$/.test(new URL(call.url).pathname),
    );
    const readback = apiCalls.find(
      (call) => call.method === 'GET' && /\/households\/[^/]+$/.test(new URL(call.url).pathname),
    );
    const corsErrors = consoleErrors.filter((text) => CORS_PATTERN.test(text));

    const report = {
      origin,
      householdName,
      flowError: flowError ? flowError.message.split('\n')[0] : null,
      create,
      readback,
      apiCalls,
      crossOrigin,
      failedRequests,
      consoleErrors,
      corsErrors: corsErrors.length,
    };
    console.log(JSON.stringify(report, null, 2));

    const problems = [];
    if (flowError) {
      problems.push(`onboarding UI did not complete: ${flowError.message.split('\n')[0]}`);
    }
    const sameOriginApi = (call) => call && call.url.startsWith(`${origin}/api/`);
    if (!create || create.status !== 201 || !sameOriginApi(create)) {
      problems.push(`household create was not a same-origin 201 under ${origin}/api/`);
    }
    if (!readback || readback.status !== 200 || !sameOriginApi(readback)) {
      problems.push(`household readback was not a same-origin 200 under ${origin}/api/`);
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
