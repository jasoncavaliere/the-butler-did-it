/**
 * Build/config tests for the PWA export (O1).
 *
 * These are the "does the export ship an installable PWA" assertions the ticket asks for. They
 * run against a fixture `dist/` built from the **real** `public/` directory - the exporter copies
 * `public/` into `dist/` verbatim, so asserting on those bytes is asserting on the export - plus
 * a stand-in for the hashed JS bundle. Every requirement is checked in both directions: the
 * shipped assets pass, and a mutated copy that violates the requirement fails.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  APP_SHELL_URL,
  PRECACHE_BEGIN,
  PRECACHE_END,
  collectPrecacheUrls,
  injectPrecacheManifest,
  listExportFiles,
  main,
  readPrecache,
  verifyWebExport,
} = require('./pwa-export');

const UI_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(UI_ROOT, 'public');
const BUNDLE_PATH = '_expo/static/js/web/index-0123456789abcdef.js';

const tempRoots = [];

/**
 * A fixture that mirrors what `expo export --platform web` produces: everything in `public/`,
 * copied as-is, plus the generated HTML entry and the content-hashed web bundle.
 */
function buildFixtureExport(distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'butler-pwa-'))) {
  tempRoots.push(distDir);
  fs.cpSync(PUBLIC_DIR, distDir, { recursive: true });
  fs.mkdirSync(path.join(distDir, path.dirname(BUNDLE_PATH)), { recursive: true });
  fs.writeFileSync(
    path.join(distDir, BUNDLE_PATH),
    'navigator.serviceWorker.register("/sw.js");',
    'utf8'
  );
  fs.writeFileSync(path.join(distDir, 'favicon.ico'), 'icon-bytes', 'utf8');
  fs.writeFileSync(path.join(distDir, 'metadata.json'), '{"version":0}', 'utf8');
  return distDir;
}

function readManifest(distDir) {
  return JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
}

function writeManifest(distDir, manifest) {
  fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
}

afterAll(() => {
  for (const dir of tempRoots) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the exported PWA assets', () => {
  it('satisfies every installability requirement once the export is built', () => {
    const distDir = buildFixtureExport();
    injectPrecacheManifest(distDir);

    expect(verifyWebExport(distDir)).toEqual([]);
  });

  it('rejects a bare export whose worker still carries the placeholder precache', () => {
    // `expo export` on its own copies public/sw.js verbatim, so the precache lists only the shell
    // HTML and the manifest. The worker would hold a shell it cannot run and the second load with
    // the network off would render blank - so verification must fail until the build step runs.
    expect(verifyWebExport(buildFixtureExport())).toContain(
      'sw.js does not precache the exported JS bundle (/_expo/**.js); run `npm run build:web` so the export\'s file list is injected'
    );
  });

  it('declares the manifest fields a browser needs to offer an install', () => {
    const manifest = readManifest(buildFixtureExport());

    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.background_color).toBeTruthy();
  });

  it('ships 192px and 512px icons plus a maskable-capable pair', () => {
    const manifest = readManifest(buildFixtureExport());
    const sizesFor = (purpose) =>
      manifest.icons.filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes).sort();

    expect(sizesFor('any')).toEqual(['192x192', '512x512']);
    expect(sizesFor('maskable')).toEqual(['192x192', '512x512']);
  });

  it('links the manifest from the HTML template the exporter renders', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

    expect(html).toContain('rel="manifest"');
    expect(html).toContain('href="/manifest.json"');
    // The Expo template placeholders must survive, or the export loses its title and lang.
    expect(html).toContain('%WEB_TITLE%');
    expect(html).toContain('%LANG_ISO_CODE%');
  });

  it('ships a service worker that precaches the app shell before any injection runs', () => {
    const source = fs.readFileSync(path.join(PUBLIC_DIR, 'sw.js'), 'utf8');
    const precache = readPrecache(source);

    expect(source).toContain(PRECACHE_BEGIN);
    expect(source).toContain(PRECACHE_END);
    expect(precache.urls).toContain(APP_SHELL_URL);
  });
});

describe('verifyWebExport', () => {
  it('reports a directory that was never exported', () => {
    expect(verifyWebExport(path.join(os.tmpdir(), 'butler-pwa-does-not-exist'))).toEqual([
      expect.stringContaining('no export directory'),
    ]);
  });

  it('fails when the manifest is missing', () => {
    const distDir = buildFixtureExport();
    fs.rmSync(path.join(distDir, 'manifest.json'));

    expect(verifyWebExport(distDir)).toContain('missing manifest.json');
  });

  it('fails when the manifest is not valid JSON', () => {
    const distDir = buildFixtureExport();
    fs.writeFileSync(path.join(distDir, 'manifest.json'), '{ not json', 'utf8');

    expect(verifyWebExport(distDir)).toContain('manifest.json is not valid JSON');
  });

  it('fails when a required manifest field is missing', () => {
    const distDir = buildFixtureExport();
    const manifest = readManifest(distDir);
    delete manifest.short_name;
    manifest.background_color = '';
    writeManifest(distDir, manifest);

    const problems = verifyWebExport(distDir);
    expect(problems).toContain('manifest.json is missing required field "short_name"');
    expect(problems).toContain('manifest.json is missing required field "background_color"');
  });

  it('fails when the app would open in a browser tab instead of standalone', () => {
    const distDir = buildFixtureExport();
    writeManifest(distDir, { ...readManifest(distDir), display: 'browser' });

    expect(verifyWebExport(distDir)).toContain(
      'manifest.json must set "display": "standalone" to be installable'
    );
  });

  it('fails when an install-size icon or the maskable icon is missing', () => {
    const distDir = buildFixtureExport();
    const manifest = readManifest(distDir);
    manifest.icons = manifest.icons.filter(
      (icon) => icon.sizes === '192x192' && icon.purpose === 'any'
    );
    writeManifest(distDir, manifest);

    const problems = verifyWebExport(distDir);
    expect(problems).toContain('manifest.json has no 512x512 icon');
    expect(problems).toContain('manifest.json has no maskable icon');
  });

  it('fails when the manifest points at an icon the export does not contain', () => {
    const distDir = buildFixtureExport();
    const manifest = readManifest(distDir);
    manifest.icons = [...manifest.icons, { src: '/icons/missing.png', sizes: '48x48' }, { sizes: '48x48' }];
    writeManifest(distDir, manifest);

    const problems = verifyWebExport(distDir);
    expect(problems).toContain('manifest.json references a missing icon file: /icons/missing.png');
    expect(problems).toContain('manifest.json has an icon entry without a "src"');
  });

  it('fails when the service worker is missing', () => {
    const distDir = buildFixtureExport();
    fs.rmSync(path.join(distDir, 'sw.js'));

    expect(verifyWebExport(distDir)).toContain('missing sw.js');
  });

  it('fails when the service worker has no readable precache manifest', () => {
    const unparseable = buildFixtureExport();
    fs.writeFileSync(path.join(unparseable, 'sw.js'), 'const PRECACHE = {oops};', 'utf8');
    expect(verifyWebExport(unparseable)).toContain('sw.js has no readable precache manifest');

    const precacheless = buildFixtureExport();
    fs.writeFileSync(path.join(precacheless, 'sw.js'), 'self.skipWaiting();', 'utf8');
    expect(verifyWebExport(precacheless)).toContain('sw.js has no readable precache manifest');
  });

  it('fails when the manifest icons are not a list at all', () => {
    const distDir = buildFixtureExport();
    writeManifest(distDir, { ...readManifest(distDir), icons: 'icons/icon-192.png' });

    const problems = verifyWebExport(distDir);
    expect(problems).toContain('manifest.json has no 192x192 icon');
    expect(problems).toContain('manifest.json has no maskable icon');
  });

  it('fails when the service worker does not precache the app shell', () => {
    const distDir = buildFixtureExport();
    fs.writeFileSync(
      path.join(distDir, 'sw.js'),
      'const PRECACHE = {"version":"x","urls":["/manifest.json"]};',
      'utf8'
    );

    expect(verifyWebExport(distDir)).toContain('sw.js does not precache the app shell (/index.html)');
  });

  it('fails when the precache holds the shell but not the app bundle', () => {
    const distDir = buildFixtureExport();
    // Everything the shell needs to *look* right is precached - only the JS the page loads is
    // missing, which is the difference between an offline hub and an offline blank page.
    fs.writeFileSync(
      path.join(distDir, 'sw.js'),
      'const PRECACHE = {"version":"x","urls":["/","/index.html","/manifest.json"]};',
      'utf8'
    );

    expect(verifyWebExport(distDir)).toEqual([
      expect.stringContaining('does not precache the exported JS bundle (/_expo/**.js)'),
    ]);
  });

  it('fails when the precache lists a file the export does not contain', () => {
    const distDir = buildFixtureExport();
    fs.writeFileSync(
      path.join(distDir, 'sw.js'),
      'const PRECACHE = {"version":"x","urls":["/","/index.html","/gone.js"]};',
      'utf8'
    );

    expect(verifyWebExport(distDir)).toContain('sw.js precaches a missing file: /gone.js');
  });

  it('fails when the exported HTML is missing or does not link the manifest', () => {
    const linkless = buildFixtureExport();
    fs.writeFileSync(path.join(linkless, 'index.html'), '<html><head></head></html>', 'utf8');
    expect(verifyWebExport(linkless)).toContain('index.html does not link the web app manifest');

    const htmlless = buildFixtureExport();
    fs.rmSync(path.join(htmlless, 'index.html'));
    expect(verifyWebExport(htmlless)).toContain('missing index.html');
  });

  it('fails when no exported bundle registers the service worker', () => {
    const unregistered = buildFixtureExport();
    fs.writeFileSync(path.join(unregistered, BUNDLE_PATH), 'console.log("no pwa here");', 'utf8');
    expect(verifyWebExport(unregistered)).toContain('no exported bundle registers /sw.js');

    const bundleless = buildFixtureExport();
    fs.rmSync(path.join(bundleless, '_expo'), { recursive: true });
    expect(verifyWebExport(bundleless)).toContain('no exported JS bundle found under _expo/');
  });
});

describe('injectPrecacheManifest', () => {
  it('precaches every exported app-shell file and nothing else', () => {
    const distDir = buildFixtureExport();

    const precache = injectPrecacheManifest(distDir);

    expect(precache.urls).toContain('/');
    expect(precache.urls).toContain('/index.html');
    expect(precache.urls).toContain('/manifest.json');
    expect(precache.urls).toContain('/icons/icon-512.png');
    expect(precache.urls).toContain(`/${BUNDLE_PATH}`);
    // The worker must not precache itself, and build bookkeeping is not app shell.
    expect(precache.urls).not.toContain('/sw.js');
    expect(precache.urls).not.toContain('/metadata.json');
    expect(verifyWebExport(distDir)).toEqual([]);
  });

  it('writes a precache the worker can read back, keeping its markers', () => {
    const distDir = buildFixtureExport();

    const precache = injectPrecacheManifest(distDir);
    const source = fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8');

    expect(source).toContain(PRECACHE_BEGIN);
    expect(source).toContain(PRECACHE_END);
    expect(readPrecache(source)).toEqual(precache);
    // The rest of the worker survives the rewrite.
    expect(source).toContain("self.addEventListener('fetch'");
  });

  it('derives a build id from the exported bytes so a deploy busts the old cache', () => {
    const distDir = buildFixtureExport();

    const first = injectPrecacheManifest(distDir);
    expect(first.version).toMatch(/^[0-9a-f]{12}$/);

    // Re-running over an unchanged export is a no-op: same id, byte-identical worker.
    const before = fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8');
    expect(injectPrecacheManifest(distDir).version).toBe(first.version);
    expect(fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8')).toBe(before);

    // A changed asset changes the id even when the filename does not.
    fs.writeFileSync(path.join(distDir, 'favicon.ico'), 'different-bytes', 'utf8');
    expect(injectPrecacheManifest(distDir).version).not.toBe(first.version);
  });

  it('refuses to inject when the export has no service worker', () => {
    const distDir = buildFixtureExport();
    fs.rmSync(path.join(distDir, 'sw.js'));

    expect(() => injectPrecacheManifest(distDir)).toThrow(/No sw.js/);
  });

  it('refuses to inject when the service worker lost its markers', () => {
    const distDir = buildFixtureExport();
    fs.writeFileSync(path.join(distDir, 'sw.js'), 'self.addEventListener("fetch", () => {});', 'utf8');

    expect(() => injectPrecacheManifest(distDir)).toThrow(/markers/);
  });
});

describe('the export helpers', () => {
  it('lists export files as stable, sorted, url-shaped paths', () => {
    const distDir = buildFixtureExport();

    const files = listExportFiles(distDir);

    expect(files).toContain(BUNDLE_PATH);
    expect(files).toEqual([...files].sort());
    expect(collectPrecacheUrls(distDir)[0]).toBe('/');
  });

  it('reads no precache out of a worker that has none', () => {
    expect(readPrecache('self.addEventListener("fetch", () => {});')).toBeNull();
  });
});

describe('the CLI', () => {
  const silence = () => {};

  it('injects and verifies, reporting success', () => {
    const distDir = buildFixtureExport();
    const lines = [];

    const code = main(['node', 'pwa-export.js', distDir], (line) => lines.push(line), silence);

    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('app-shell files as build');
    expect(readPrecache(fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8')).urls.length).toBeGreaterThan(1);
  });

  it('verifies without touching the export under --verify-only', () => {
    const distDir = buildFixtureExport();
    injectPrecacheManifest(distDir);
    const before = fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8');

    const code = main(['node', 'pwa-export.js', distDir, '--verify-only', '--quiet'], silence, silence);

    expect(code).toBe(0);
    expect(fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8')).toBe(before);
  });

  it('defaults to ./dist and to the console when handed nothing else', () => {
    // `npm run verify:web-export` runs exactly this: no explicit directory, no injected loggers.
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'butler-pwa-cwd-'));
    tempRoots.push(workdir);
    injectPrecacheManifest(buildFixtureExport(path.join(workdir, 'dist')));
    const cwd = process.cwd();

    try {
      process.chdir(workdir);
      expect(main(['node', 'pwa-export.js', '--verify-only', '--quiet'])).toBe(0);
    } finally {
      process.chdir(cwd);
    }
  });

  it('fails loudly when the export is not installable', () => {
    const distDir = buildFixtureExport();
    fs.rmSync(path.join(distDir, 'manifest.json'));
    const errors = [];

    const code = main(['node', 'pwa-export.js', distDir, '--quiet'], silence, (line) =>
      errors.push(line)
    );

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('missing manifest.json');
  });
});
