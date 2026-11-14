#!/usr/bin/env node
// Layout check for the pilot landing page (#134, AC5 and AC6).
//
// Usage: node Butler.Site/ci/check-layout.mjs
//
// Loads Butler.Site/index.html (file://) in headless Chrome at two viewport
// widths and measures the rendered page:
//
//   375 x 800, mobile (AC5): the viewport is really 375px wide, there is no
//     horizontal scroll (scrollWidth <= clientWidth, and no element extends
//     past either edge), and the capabilities grid has one track with the
//     three cards stacked in one column.
//   1280 x 800, desktop (AC6): no horizontal scroll by the same measures, and
//     the capabilities grid has three tracks with the three cards side by side
//     on one row.
//
// Each failure prints a reason to stderr and the script exits 1; on success it
// prints the measurements and "check-layout: OK".
//
// No dependencies: it drives Chrome over the DevTools protocol on
// --remote-debugging-pipe with Node's built-in modules only, so there is no
// package.json or node_modules in Butler.Site/. It needs Node 18+ and a Chrome
// or Chromium binary: CHROME_PATH if set, otherwise the first of
// google-chrome, google-chrome-stable, chromium, chromium-browser on PATH
// (GitHub's ubuntu-latest runners ship google-chrome).
import { spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_URL = pathToFileURL(join(SITE, 'index.html')).href;
const TIMEOUT_MS = 60000;

const VIEWPORTS = [
  { name: 'mobile', ac: 'AC5', width: 375, height: 800, mobile: true, tracks: 1, rows: 3 },
  { name: 'desktop', ac: 'AC6', width: 1280, height: 800, mobile: false, tracks: 3, rows: 1 },
];

function die(message) {
  console.error(`check-layout: ${message}`);
  process.exit(1);
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const name of names) {
      const candidate = join(dir, name);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // not here; keep looking
      }
    }
  }
  return die('no Chrome found: set CHROME_PATH or put google-chrome/chromium on PATH');
}

// A minimal DevTools-protocol client over --remote-debugging-pipe: Chrome
// reads commands on fd 3 and writes replies and events on fd 4, each message
// a JSON object terminated by a NUL byte.
function launch(chromePath, profileDir) {
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-pipe',
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stdio[2].on('data', (chunk) => {
    stderr += chunk;
  });
  child.on('error', (err) => die(`could not start ${chromePath}: ${err.message}`));

  const toChrome = child.stdio[3];
  const fromChrome = child.stdio[4];
  const pending = new Map();
  const listeners = [];
  let nextId = 1;
  let buffer = '';

  fromChrome.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve: ok, reject, method } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else ok(message.result);
      } else if (message.method) {
        for (const listener of [...listeners]) listener(message);
      }
    }
  });
  child.on('exit', (code) => {
    for (const { reject, method } of pending.values()) {
      reject(new Error(`Chrome exited (code ${code}) during ${method}\n${stderr}`));
    }
    pending.clear();
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((ok, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: ok, reject, method });
      toChrome.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });

  const once = (method, sessionId) =>
    new Promise((ok) => {
      const listener = (message) => {
        if (message.method === method && message.sessionId === sessionId) {
          listeners.splice(listeners.indexOf(listener), 1);
          ok(message.params);
        }
      };
      listeners.push(listener);
    });

  return { child, send, once };
}

// Runs in the page. Returns the numbers the assertions need.
const MEASURE = `(() => {
  const de = document.documentElement;
  const list = document.querySelector('.capabilities');
  const cards = [...document.querySelectorAll('.capability')];
  const style = list ? getComputedStyle(list) : null;
  const tracks = style ? style.gridTemplateColumns.trim().split(/\\s+/).filter(Boolean).length : 0;
  const rects = cards.map((c) => c.getBoundingClientRect());
  const overflowing = [...document.body.querySelectorAll('*')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0 && (r.right > de.clientWidth + 0.5 || r.left < -0.5))
    .map(({ el, r }) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\\s+/).join('.') : '') +
      ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
  return JSON.stringify({
    innerWidth: window.innerWidth,
    clientWidth: de.clientWidth,
    scrollWidth: de.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    display: style ? style.display : null,
    gridTemplateColumns: style ? style.gridTemplateColumns : null,
    tracks,
    cards: cards.length,
    rows: new Set(rects.map((r) => Math.round(r.top))).size,
    columns: new Set(rects.map((r) => Math.round(r.left))).size,
    cardWidths: rects.map((r) => Math.round(r.width)),
    overflowing,
  });
})()`;

async function measure(browser, viewport) {
  const { send, once } = browser;
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send(
    'Emulation.setDeviceMetricsOverride',
    {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    },
    sessionId,
  );
  const loaded = once('Page.loadEventFired', sessionId);
  const nav = await send('Page.navigate', { url: PAGE_URL }, sessionId);
  if (nav.errorText) throw new Error(`could not load ${PAGE_URL}: ${nav.errorText}`);
  await loaded;
  const { result, exceptionDetails } = await send(
    'Runtime.evaluate',
    { expression: MEASURE, returnByValue: true },
    sessionId,
  );
  if (exceptionDetails) throw new Error(`measuring failed: ${exceptionDetails.text}`);
  await send('Target.closeTarget', { targetId });
  return JSON.parse(result.value);
}

function check(viewport, m) {
  const problems = [];
  const at = `${viewport.width}px (${viewport.ac})`;
  if (m.innerWidth !== viewport.width) {
    problems.push(`at ${at} the layout viewport is ${m.innerWidth}px wide, expected ${viewport.width}px`);
  }
  if (m.scrollWidth > m.clientWidth || m.bodyScrollWidth > m.clientWidth) {
    problems.push(
      `at ${at} the page scrolls horizontally: scrollWidth ${m.scrollWidth} (body ${m.bodyScrollWidth}) > clientWidth ${m.clientWidth}`,
    );
  }
  if (m.overflowing.length > 0) {
    problems.push(`at ${at} these elements extend past the viewport: ${m.overflowing.slice(0, 10).join(', ')}`);
  }
  if (m.display !== 'grid') {
    problems.push(`at ${at} .capabilities is display:${m.display}, expected grid (is styles.css loading?)`);
  }
  if (m.cards !== 3) {
    problems.push(`at ${at} found ${m.cards} .capability cards, expected 3`);
  }
  if (m.tracks !== viewport.tracks) {
    problems.push(
      `at ${at} .capabilities has ${m.tracks} column track(s) (${m.gridTemplateColumns}), expected ${viewport.tracks}`,
    );
  }
  if (m.rows !== viewport.rows || m.columns !== 3 / viewport.rows) {
    problems.push(
      `at ${at} the cards sit in ${m.rows} row(s) and ${m.columns} column(s), expected ${viewport.rows} row(s) and ${3 / viewport.rows} column(s)`,
    );
  }
  return problems;
}

async function main() {
  const chromePath = findChrome();
  const profileDir = mkdtempSync(join(tmpdir(), 'check-layout-'));
  const browser = launch(chromePath, profileDir);
  const timer = setTimeout(() => {
    browser.child.kill('SIGKILL');
    die(`timed out after ${TIMEOUT_MS / 1000}s`);
  }, TIMEOUT_MS);

  const problems = [];
  try {
    for (const viewport of VIEWPORTS) {
      const m = await measure(browser, viewport);
      console.log(
        `check-layout: ${viewport.name} ${viewport.width}x${viewport.height}: innerWidth=${m.innerWidth} ` +
          `clientWidth=${m.clientWidth} scrollWidth=${m.scrollWidth} tracks=${m.tracks} ` +
          `(${m.gridTemplateColumns}) rows=${m.rows} columns=${m.columns} cardWidths=${m.cardWidths.join('/')}`,
      );
      problems.push(...check(viewport, m));
    }
  } finally {
    clearTimeout(timer);
    await browser.send('Browser.close').catch(() => {});
    browser.child.kill();
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(`check-layout: ${p}`);
    process.exit(1);
  }
  console.log('check-layout: OK');
}

main().catch((err) => die(err.stack || err.message));
