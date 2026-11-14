// Headless check that the hub's service worker registers and activates (#94 AC6).
//
// Usage: node demo/ci/check-service-worker.cjs [url]
//   url defaults to http://localhost:8080/ (localhost is a secure context, so
//   service workers are allowed over plain HTTP).
// Env:
//   NODE_PATH  - where `playwright` is installed (it is not a repo dependency).
//   PW_CHANNEL - optional browser channel, e.g. "chrome" for desktop Chrome.
//
// Prints {scope, scriptURL, state} and exits 1 unless the worker at /sw.js is
// activated with the site root as its scope.
'use strict';

const { chromium } = require('playwright');

const url = process.argv[2] || 'http://localhost:8080/';
const READY_TIMEOUT_MS = 30000;

async function main() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load' });
    const result = await page.evaluate(async (timeoutMs) => {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`service worker not ready after ${timeoutMs}ms`)), timeoutMs),
      );
      const reg = await Promise.race([navigator.serviceWorker.ready, timeout]);
      const deadline = Date.now() + timeoutMs;
      while (!(reg.active && reg.active.state === 'activated') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return {
        scope: reg.scope,
        scriptURL: reg.active ? reg.active.scriptURL : null,
        state: reg.active ? reg.active.state : null,
      };
    }, READY_TIMEOUT_MS);

    console.log(JSON.stringify(result));
    const origin = new URL(url).origin;
    const ok =
      result.scope === `${origin}/` &&
      typeof result.scriptURL === 'string' &&
      result.scriptURL.endsWith('/sw.js') &&
      result.state === 'activated';
    if (!ok) {
      console.error(`service worker check failed for ${url}`);
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
