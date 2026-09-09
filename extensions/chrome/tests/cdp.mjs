// A very small DevTools protocol client, enough to open a page, run script in
// it, and take a picture. Used by the DOM test and by the store screenshot
// capture, so both drive a real browser without pulling in a dependency.
//
// Node's built-in WebSocket does the talking, so there is nothing to install.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findChrome() {
  return CANDIDATES.find((path) => existsSync(path)) || null;
}

export async function launchChrome({ width = 1280, height = 800 } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome found. Set CHROME to a browser binary.');

  const profile = mkdtempSync(join(tmpdir(), 'varterm-cdp-'));
  const proc = spawn(chrome, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ]);

  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome never reported a debugging port')), 20000);
    let buffered = '';
    proc.stderr.on('data', (chunk) => {
      buffered += chunk.toString();
      const match = buffered.match(/ws:\/\/[^\s]+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    proc.on('exit', () => reject(new Error('Chrome exited before it was ready')));
  });

  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('Could not connect to Chrome'));
  });

  let nextId = 1;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  };

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

  // createTarget only accepts a size for a new window, so the viewport is set
  // here instead.
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: false },
    sessionId
  );

  await send('Page.enable', {}, sessionId);

  return {
    async evaluate(expression, awaitPromise = false) {
      const result = await send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise },
        sessionId
      );
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || 'evaluation failed');
      }
      return result.result.value;
    },
    async navigate(url) {
      await send('Page.navigate', { url }, sessionId);
      await new Promise((resolve) => setTimeout(resolve, 900));
    },
    async screenshot() {
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
      return Buffer.from(data, 'base64');
    },
    close() {
      socket.close();
      proc.kill();
      // Chrome may still be flushing its profile as it dies, so a failed
      // delete is not worth failing a test over. It is a temp directory.
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // The OS will clear it.
      }
    },
  };
}
