/**
 * PWA post-export step for the Expo web export (O1).
 *
 * `expo export --platform web` already emits everything this app needs to be installable: it
 * copies `public/` (manifest, icons, sw.js) into `dist/` and uses `public/index.html` as the HTML
 * template (https://docs.expo.dev/guides/progressive-web-apps/). This script does the two things
 * the exporter cannot:
 *
 *   1. `injectPrecacheManifest(distDir)` - rewrites the `butler-precache` block in `dist/sw.js`
 *      with the app-shell files the export actually produced (Expo's content-hashed filenames are
 *      the cache busting) plus a build id derived from their bytes, so each deploy opens a fresh
 *      cache and the worker's `activate` handler evicts the previous one.
 *   2. `verifyWebExport(distDir)` - asserts the export is installable: manifest present with the
 *      required fields and icons, service worker present with a precache holding both the app shell
 *      and the exported JS bundle (so an export that never had step 1 run over it is rejected rather
 *      than shipped to render blank offline), manifest linked from the exported HTML, and the
 *      exported bundle registering the worker.
 *
 * CLI:
 *   node scripts/pwa-export.js [distDir] [--verify-only] [--quiet]
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PRECACHE_BEGIN = '/* butler-precache:begin */';
const PRECACHE_END = '/* butler-precache:end */';
const PRECACHE_EXPRESSION = /const PRECACHE = (\{[\s\S]*?\});/;

const SERVICE_WORKER_FILE = 'sw.js';
const MANIFEST_FILE = 'manifest.json';
const HTML_FILE = 'index.html';
const APP_SHELL_URL = '/index.html';

/**
 * Where the exporter puts the app's own JS. The shell HTML is useless without it, so a precache
 * that lists no bundle from here is the signature of an export that never had the build step run
 * over it - `public/sw.js` ships with a placeholder list of `/`, `/index.html`, `/manifest.json`.
 */
const BUNDLE_DIR = '_expo/';
const BUNDLE_URL_PREFIX = `/${BUNDLE_DIR}`;

/** True for an exported app bundle, as a `dist/`-relative path (`_expo/...js`). */
function isBundleFile(file) {
  return file.startsWith(BUNDLE_DIR) && file.endsWith('.js');
}

/** Export output that must never be precached: the worker itself, and build bookkeeping. */
const PRECACHE_EXCLUDED = new Set([SERVICE_WORKER_FILE, 'metadata.json']);

const REQUIRED_MANIFEST_FIELDS = [
  'name',
  'short_name',
  'start_url',
  'display',
  'theme_color',
  'background_color',
  'icons',
];

const REQUIRED_ICON_SIZES = ['192x192', '512x512'];

/** Every file in `dir`, as `/`-separated paths relative to it, sorted for a stable build id. */
function listExportFiles(dir, relativeTo = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listExportFiles(absolute, relativeTo));
    } else {
      files.push(path.relative(relativeTo, absolute).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

/** The app-shell URLs to precache: the site root plus every exported static file. */
function collectPrecacheUrls(distDir) {
  const files = listExportFiles(distDir).filter((file) => !PRECACHE_EXCLUDED.has(file));
  return ['/', ...files.map((file) => `/${file}`)];
}

/** A build id that changes whenever any precached byte changes, so a deploy re-caches. */
function computeBuildId(distDir, urls) {
  const hash = crypto.createHash('sha256');
  for (const url of urls) {
    if (url === '/') continue;
    hash.update(url);
    hash.update(fs.readFileSync(path.join(distDir, url.slice(1))));
  }
  return hash.digest('hex').slice(0, 12);
}

function readPrecache(serviceWorkerSource) {
  const match = PRECACHE_EXPRESSION.exec(serviceWorkerSource);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Rewrite `dist/sw.js`'s precache block with the real export. Idempotent: the markers are
 * re-emitted, so running it twice over the same `dist/` produces the same file.
 */
function injectPrecacheManifest(distDir) {
  const serviceWorkerPath = path.join(distDir, SERVICE_WORKER_FILE);
  if (!fs.existsSync(serviceWorkerPath)) {
    throw new Error(
      `No ${SERVICE_WORKER_FILE} in ${distDir}. Did \`expo export --platform web\` run, and is public/${SERVICE_WORKER_FILE} committed?`
    );
  }

  const source = fs.readFileSync(serviceWorkerPath, 'utf8');
  const begin = source.indexOf(PRECACHE_BEGIN);
  const end = source.indexOf(PRECACHE_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `${SERVICE_WORKER_FILE} is missing its ${PRECACHE_BEGIN} / ${PRECACHE_END} markers; nothing to inject into.`
    );
  }

  const urls = collectPrecacheUrls(distDir);
  const precache = { version: computeBuildId(distDir, urls), urls };
  const block = `${PRECACHE_BEGIN}\nconst PRECACHE = ${JSON.stringify(precache)};\n`;

  fs.writeFileSync(serviceWorkerPath, source.slice(0, begin) + block + source.slice(end), 'utf8');
  return precache;
}

function verifyManifest(distDir, problems) {
  const manifestPath = path.join(distDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    problems.push(`missing ${MANIFEST_FILE}`);
    return null;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    problems.push(`${MANIFEST_FILE} is not valid JSON`);
    return null;
  }

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    const value = manifest[field];
    if (value === undefined || value === null || value === '') {
      problems.push(`${MANIFEST_FILE} is missing required field "${field}"`);
    }
  }

  if (manifest.display !== 'standalone') {
    problems.push(`${MANIFEST_FILE} must set "display": "standalone" to be installable`);
  }

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  for (const size of REQUIRED_ICON_SIZES) {
    if (!icons.some((icon) => icon && icon.sizes === size)) {
      problems.push(`${MANIFEST_FILE} has no ${size} icon`);
    }
  }
  if (!icons.some((icon) => icon && typeof icon.purpose === 'string' && icon.purpose.includes('maskable'))) {
    problems.push(`${MANIFEST_FILE} has no maskable icon`);
  }
  for (const icon of icons) {
    if (!icon || typeof icon.src !== 'string') {
      problems.push(`${MANIFEST_FILE} has an icon entry without a "src"`);
      continue;
    }
    if (icon.src.startsWith('/') && !fs.existsSync(path.join(distDir, icon.src.slice(1)))) {
      problems.push(`${MANIFEST_FILE} references a missing icon file: ${icon.src}`);
    }
  }

  return manifest;
}

function verifyServiceWorker(distDir, problems) {
  const serviceWorkerPath = path.join(distDir, SERVICE_WORKER_FILE);
  if (!fs.existsSync(serviceWorkerPath)) {
    problems.push(`missing ${SERVICE_WORKER_FILE}`);
    return;
  }

  const source = fs.readFileSync(serviceWorkerPath, 'utf8');
  const precache = readPrecache(source);
  if (!precache || !Array.isArray(precache.urls)) {
    problems.push(`${SERVICE_WORKER_FILE} has no readable precache manifest`);
    return;
  }
  if (!precache.urls.includes(APP_SHELL_URL)) {
    problems.push(`${SERVICE_WORKER_FILE} does not precache the app shell (${APP_SHELL_URL})`);
  }
  // The HTML alone renders blank offline. Without the app bundle in the precache the worker never
  // holds the JS the shell loads, so the "second load with the network off" criterion fails.
  if (!precache.urls.some((url) => isBundleFile(url.slice(1)))) {
    problems.push(
      `${SERVICE_WORKER_FILE} does not precache the exported JS bundle (${BUNDLE_URL_PREFIX}**.js); run \`npm run build:web\` so the export's file list is injected`
    );
  }
  for (const url of precache.urls) {
    if (url === '/') continue;
    if (!fs.existsSync(path.join(distDir, url.slice(1)))) {
      problems.push(`${SERVICE_WORKER_FILE} precaches a missing file: ${url}`);
    }
  }
}

function verifyHtml(distDir, problems) {
  const htmlPath = path.join(distDir, HTML_FILE);
  if (!fs.existsSync(htmlPath)) {
    problems.push(`missing ${HTML_FILE}`);
    return;
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (!/<link[^>]+rel=["']manifest["'][^>]*>/i.test(html)) {
    problems.push(`${HTML_FILE} does not link the web app manifest`);
  }
}

/** The exported app bundle must actually register the worker (AC: "registered by the app on load"). */
function verifyRegistration(distDir, problems) {
  const bundles = listExportFiles(distDir).filter(isBundleFile);
  if (bundles.length === 0) {
    problems.push(`no exported JS bundle found under ${BUNDLE_DIR}`);
    return;
  }
  const registers = bundles.some((file) =>
    fs.readFileSync(path.join(distDir, file), 'utf8').includes(`/${SERVICE_WORKER_FILE}`)
  );
  if (!registers) {
    problems.push(`no exported bundle registers /${SERVICE_WORKER_FILE}`);
  }
}

/**
 * Assert the export is an installable PWA. Returns the list of problems - empty means the export
 * satisfies the manifest + service worker + linked-from-HTML install criteria.
 */
function verifyWebExport(distDir) {
  const problems = [];
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    return [`no export directory at ${distDir}; run \`expo export --platform web\` first`];
  }
  verifyHtml(distDir, problems);
  verifyManifest(distDir, problems);
  verifyServiceWorker(distDir, problems);
  verifyRegistration(distDir, problems);
  return problems;
}

function main(argv, log = console.log, logError = console.error) {
  const args = argv.slice(2);
  const verifyOnly = args.includes('--verify-only');
  const quiet = args.includes('--quiet');
  const distDir = path.resolve(args.find((arg) => !arg.startsWith('--')) ?? 'dist');

  if (!verifyOnly) {
    const precache = injectPrecacheManifest(distDir);
    if (!quiet) {
      log(`PWA: precached ${precache.urls.length} app-shell files as build ${precache.version}`);
    }
  }

  const problems = verifyWebExport(distDir);
  if (problems.length > 0) {
    logError(`PWA: ${distDir} is not an installable export:`);
    for (const problem of problems) logError(`  - ${problem}`);
    return 1;
  }
  if (!quiet) log(`PWA: ${distDir} is an installable export (manifest + service worker verified)`);
  return 0;
}

module.exports = {
  APP_SHELL_URL,
  PRECACHE_BEGIN,
  PRECACHE_END,
  REQUIRED_ICON_SIZES,
  REQUIRED_MANIFEST_FIELDS,
  collectPrecacheUrls,
  injectPrecacheManifest,
  listExportFiles,
  main,
  readPrecache,
  verifyWebExport,
};

/* istanbul ignore if -- CLI entrypoint; `main` itself is covered directly */
if (require.main === module) {
  process.exitCode = main(process.argv);
}
