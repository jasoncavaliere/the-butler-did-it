// Check that a service worker carries the precache list `npm run build:web` injects (#178).
//
// Usage: node demo/ci/check-precache.cjs <url-or-file>
//   An http(s) URL is fetched (a non-2xx response fails); anything else is read
//   as a local file, e.g. Butler.UI/dist/sw.js.
//
// A bare `expo export` copies Butler.UI/public/sw.js verbatim, and its
// placeholder list is already non-empty ("/", "/index.html", "/manifest.json",
// version "dev"), so this checks what only the build step produces: a 12-hex
// build id, the app shell, and at least one exported /_expo/**.js bundle. The
// block is parsed with readPrecache from Butler.UI/scripts/pwa-export.js, so the
// format lives in one place, and the bundle rule matches its verifyServiceWorker.
//
// Prints {source, version, urls, bundles} and exits 0 when the list is real.
// Exits 1 only when it lists problems on stderr (a rejection). Exits 2 on bad
// usage or any error (unreadable file, failed or non-2xx fetch, failed require,
// thrown error), so callers can tell a rejection from a crash (#259).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BUILD_ID = /^[0-9a-f]{12}$/;
const APP_SHELL_URL = '/index.html';
const BUNDLE_URL_PREFIX = '/_expo/';

function isBundleUrl(url) {
  return typeof url === 'string' && url.startsWith(BUNDLE_URL_PREFIX) && url.endsWith('.js');
}

async function readSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`GET ${source} returned ${response.status}`);
    }
    return response.text();
  }
  return fs.readFileSync(source, 'utf8');
}

function findProblems(precache) {
  if (!precache || !Array.isArray(precache.urls)) {
    return ['no readable precache block (const PRECACHE = {...} with a urls array)'];
  }
  const problems = [];
  if (typeof precache.version !== 'string' || !BUILD_ID.test(precache.version)) {
    problems.push(`version ${JSON.stringify(precache.version)} is not a 12-hex build id`);
  }
  if (!precache.urls.includes(APP_SHELL_URL)) {
    problems.push(`urls does not include the app shell (${APP_SHELL_URL})`);
  }
  if (!precache.urls.some(isBundleUrl)) {
    problems.push(`urls lists no exported JS bundle (${BUNDLE_URL_PREFIX}**.js)`);
  }
  return problems;
}

async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error('usage: node demo/ci/check-precache.cjs <url-or-file>');
    process.exit(2);
  }

  // Required here, not at the top, so a failed require exits 2 via .catch (#259).
  const { readPrecache } = require(path.join(__dirname, '..', '..', 'Butler.UI', 'scripts', 'pwa-export.js'));
  const precache = readPrecache(await readSource(source));
  const problems = findProblems(precache);
  if (problems.length > 0) {
    console.error(`check-precache: ${source} is not a build:web service worker:`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    console.error('hint: run npm run build:web, not a bare expo export');
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify({
      source,
      version: precache.version,
      urls: precache.urls.length,
      bundles: precache.urls.filter(isBundleUrl).length,
    }),
  );
}

main().catch((err) => {
  console.error(`check-precache: ${err && err.message ? err.message : err}`);
  process.exit(2);
});
