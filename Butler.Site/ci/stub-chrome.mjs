#!/usr/bin/env node
// Stub Chrome for ci/check-layout.test.mjs (#230). Not a browser.
//
// Usage: CHROME_PATH=Butler.Site/ci/stub-chrome.mjs node Butler.Site/ci/check-layout.mjs
//
// check-layout.mjs spawns CHROME_PATH directly, so this file needs its shebang
// and exec bit. It ignores its arguments and speaks just enough of the
// DevTools protocol on --remote-debugging-pipe (commands in on fd 3, replies
// and events out on fd 4, each a JSON object terminated by a NUL byte) to get
// check-layout.mjs through both viewports:
//
//   Runtime.evaluate returns measurements that pass at 375px and 1280px, or,
//     with STUB_LAYOUT=fail, report 2 column tracks at both widths.
//   Browser.close is never answered, like a stuck Chrome, unless
//     STUB_CLOSE=answer, in which case it replies and exits 0.
//
// It ignores SIGTERM, so only SIGKILL stops it while fd 3 is open. When fd 3
// reaches EOF it exits 0 (so it is never orphaned), first writing "eof" to
// STUB_EOF_FILE if that is set. It writes its pid to STUB_PID_FILE if set.
// Node built-ins only.
import { createReadStream, createWriteStream, writeFileSync } from 'node:fs';
import net from 'node:net';

process.on('SIGTERM', () => {});

if (process.env.STUB_PID_FILE) writeFileSync(process.env.STUB_PID_FILE, String(process.pid));

function open(fd, readable) {
  try {
    return new net.Socket({ fd, readable, writable: !readable });
  } catch {
    return readable ? createReadStream(null, { fd }) : createWriteStream(null, { fd });
  }
}

const input = open(3, true);
const output = open(4, false);
output.on('error', () => {});

const fail = process.env.STUB_LAYOUT === 'fail';
const answerClose = process.env.STUB_CLOSE === 'answer';
const widths = new Map();
let nextSession = 1;
let nextTarget = 1;

function write(message, done) {
  output.write(`${JSON.stringify(message)}\0`, done);
}

function measurements(width) {
  const desktop = width >= 1280;
  return {
    innerWidth: width,
    clientWidth: width,
    scrollWidth: width,
    bodyScrollWidth: width,
    display: 'grid',
    gridTemplateColumns: fail ? '150px 150px' : desktop ? '300px 300px 300px' : '343px',
    tracks: fail ? 2 : desktop ? 3 : 1,
    cards: 3,
    rows: desktop ? 1 : 3,
    columns: desktop ? 3 : 1,
    cardWidths: desktop ? [300, 300, 300] : [343, 343, 343],
    overflowing: [],
  };
}

function handle({ id, method, params = {}, sessionId }) {
  const reply = (result, done) => write({ id, sessionId, result }, done);
  switch (method) {
    case 'Target.createTarget':
      return reply({ targetId: `target-${nextTarget++}` });
    case 'Target.attachToTarget':
      return reply({ sessionId: `session-${nextSession++}` });
    case 'Emulation.setDeviceMetricsOverride':
      widths.set(sessionId, params.width);
      return reply({});
    case 'Page.navigate':
      reply({ frameId: 'frame', loaderId: 'loader' });
      return write({ method: 'Page.loadEventFired', params: { timestamp: 0 }, sessionId });
    case 'Runtime.evaluate':
      return reply({
        result: { type: 'string', value: JSON.stringify(measurements(widths.get(sessionId))) },
      });
    case 'Target.closeTarget':
      return reply({ success: true });
    case 'Browser.close':
      if (answerClose) reply({}, () => process.exit(0));
      return undefined; // a stuck Chrome: never answer
    default:
      return reply({});
  }
}

let buffer = '';
input.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let end;
  while ((end = buffer.indexOf('\0')) !== -1) {
    const text = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (text) handle(JSON.parse(text));
  }
});

let exiting = false;
function onEof() {
  if (exiting) return;
  exiting = true;
  if (process.env.STUB_EOF_FILE) {
    try {
      writeFileSync(process.env.STUB_EOF_FILE, 'eof');
    } catch {
      // best effort
    }
  }
  process.exit(0);
}
input.on('end', onEof);
input.on('close', onEof);
input.on('error', onEof);
