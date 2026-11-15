// Shutdown test for the layout check (#230).
//
// Usage: node --test Butler.Site/ci/check-layout.test.mjs
//
// Runs check-layout.mjs as a separate process against ci/stub-chrome.mjs (no
// real Chrome needed) and checks that the script exits within 15 s of the
// checks finishing, with its normal pass/fail result, even when Chrome never
// answers Browser.close, and that it SIGKILLs the stuck Chrome. The checks end
// when check-layout.mjs prints its "check-layout: desktop" line, after the last
// measurement. A 30 s safety timer kills everything and fails the test if the
// script hangs. Node built-ins only.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const CI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(CI, 'check-layout.mjs');
const STUB = join(CI, 'stub-chrome.mjs');
const SAFETY_MS = 30000;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

function killQuietly(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {
    // already gone
  }
}

function readPid(file) {
  try {
    return Number(readFileSync(file, 'utf8')) || null;
  } catch {
    return null;
  }
}

// Runs check-layout.mjs with CHROME_PATH pointing at the stub. Resolves on exit
// with the output, timings and the stub's pid and EOF marker.
function runCheck(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'check-layout-test-'));
  const pidFile = join(dir, 'stub.pid');
  const eofFile = join(dir, 'stub.eof');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: {
        ...process.env,
        ...env,
        CHROME_PATH: STUB,
        STUB_PID_FILE: pidFile,
        STUB_EOF_FILE: eofFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let checksDoneAt = null;
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (checksDoneAt === null && stdout.includes('check-layout: desktop')) checksDoneAt = Date.now();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const safety = setTimeout(() => {
      child.kill('SIGKILL');
      const stubPid = readPid(pidFile);
      if (stubPid) killQuietly(stubPid, 'SIGKILL');
      rmSync(dir, { recursive: true, force: true });
      reject(new Error(`check-layout.mjs did not exit within ${SAFETY_MS / 1000}s\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, SAFETY_MS);
    child.on('error', (err) => {
      clearTimeout(safety);
      reject(err);
    });
    child.on('exit', (code, signal) => {
      const exitedAt = Date.now();
      clearTimeout(safety);
      const stubPid = readPid(pidFile);
      // Give the stub a moment to handle a pending EOF before reading the marker.
      setTimeout(() => {
        const eof = existsSync(eofFile);
        rmSync(dir, { recursive: true, force: true });
        resolve({ code, signal, stdout, stderr, checksDoneAt, exitedAt, stubPid, eof });
      }, 200);
    });
  });
}

async function waitForDeath(pid, ms) {
  const deadline = Date.now() + ms;
  while (alive(pid) && Date.now() < deadline) {
    await new Promise((ok) => setTimeout(ok, 50));
  }
  return !alive(pid);
}

test('stuck Chrome: a passing layout still exits 0 with check-layout: OK', { timeout: SAFETY_MS }, async () => {
  const r = await runCheck();
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /check-layout: OK/);
});

test('stuck Chrome: exits within 15 s after the checks finish', { timeout: SAFETY_MS }, async () => {
  const r = await runCheck();
  assert.notEqual(r.checksDoneAt, null, `checks never finished\n${r.stdout}\n${r.stderr}`);
  const elapsed = r.exitedAt - r.checksDoneAt;
  assert.ok(elapsed <= 15000, `exited ${elapsed} ms after the checks finished, expected <= 15000`);
});

test('stuck Chrome: shutdown is bounded and the stub is SIGKILLed', { timeout: SAFETY_MS }, async () => {
  const r = await runCheck();
  assert.notEqual(r.checksDoneAt, null, `checks never finished\n${r.stdout}\n${r.stderr}`);
  const elapsed = r.exitedAt - r.checksDoneAt;
  assert.ok(elapsed <= 10000, `exited ${elapsed} ms after the checks finished, expected <= 10000`);
  assert.ok(r.stubPid, 'stub never wrote its pid');
  assert.ok(await waitForDeath(r.stubPid, 2000), `stub ${r.stubPid} is still running`);
  // The stub ignores SIGTERM and records an EOF exit; no marker means SIGKILL.
  assert.equal(r.eof, false, 'stub exited on pipe EOF, not on SIGKILL');
});

test('stuck Chrome: a failing layout still exits 1 with its problem', { timeout: SAFETY_MS }, async () => {
  const r = await runCheck({ STUB_LAYOUT: 'fail' });
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stderr, /column track\(s\)/);
  assert.doesNotMatch(r.stdout, /check-layout: OK/);
  if (r.stubPid) assert.ok(await waitForDeath(r.stubPid, 2000), `stub ${r.stubPid} is still running`);
});

test('answering Chrome: exits promptly when Browser.close is answered', { timeout: SAFETY_MS }, async () => {
  const r = await runCheck({ STUB_CLOSE: 'answer' });
  assert.equal(r.code, 0, r.stderr);
  assert.notEqual(r.checksDoneAt, null, `checks never finished\n${r.stdout}\n${r.stderr}`);
  const elapsed = r.exitedAt - r.checksDoneAt;
  assert.ok(elapsed < 3000, `exited ${elapsed} ms after the checks finished, expected < 3000`);
});
