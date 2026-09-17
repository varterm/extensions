import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  drainIsHeld,
  ownQueuePlace,
  pruneQueueItems,
  queueHasText,
  queueIsAbandoned,
  usableQueueItems,
} from '../dist/listen-queue.js';

const MODULE = new URL('../dist/listen-queue.js', import.meta.url).href;
const MINUTE = 60 * 1000;
const NOW = 1_700_000_000_000;

const alive = () => true;
const dead = () => false;

function item(overrides = {}) {
  return { id: 'q-1', text: 'hello', label: 'agent reply', pid: 1, enqueuedAt: NOW, ...overrides };
}

test('an item that has not waited long is kept', () => {
  const kept = pruneQueueItems([item({ enqueuedAt: NOW - MINUTE })], NOW, 10 * MINUTE);
  assert.equal(kept.length, 1);
});

test('an item past its expiry is dropped', () => {
  const kept = pruneQueueItems([item({ enqueuedAt: NOW - 11 * MINUTE })], NOW, 10 * MINUTE);
  assert.equal(kept.length, 0);
});

test('an expiry of zero keeps items however long they wait', () => {
  const old = [item({ enqueuedAt: NOW - 500 * MINUTE })];
  assert.equal(pruneQueueItems(old, NOW, 0).length, 1);
});

test('malformed entries are dropped rather than replayed', () => {
  const junk = [item({ text: '' }), item({ enqueuedAt: undefined }), item({ pid: 0 }), {}];
  assert.equal(pruneQueueItems(junk, NOW, 10 * MINUTE).length, 0);
});

test('a queue left by a session that has ended is abandoned', () => {
  // This is what clears the queue on restart, with no window having to tidy up
  // on its way out.
  assert.equal(queueIsAbandoned([item()], dead), true);
  assert.equal(usableQueueItems([item()], NOW, 10 * MINUTE, dead).length, 0);
});

test('closing one window does not discard what it queued', () => {
  // The whole queue is judged together, so a reply queued by a project you have
  // since closed still gets read while other windows are open.
  const items = [item({ id: 'q-gone', pid: 1 }), item({ id: 'q-here', pid: 2 })];
  const liveSecond = (pid) => pid === 2;
  assert.equal(queueIsAbandoned(items, liveSecond), false);
  assert.equal(usableQueueItems(items, NOW, 10 * MINUTE, liveSecond).length, 2);
});

test('an empty queue is not treated as abandoned', () => {
  assert.equal(queueIsAbandoned([], dead), false);
});

test('the queue holds one copy of any given text', () => {
  const items = [item({ text: 'hello' })];
  assert.equal(queueHasText(items, 'hello'), true);
  assert.equal(queueHasText(items, '  hello  '), true);
  assert.equal(queueHasText(items, 'goodbye'), false);
});

test('a window with nothing waiting has no place in the queue', () => {
  const others = [item({ pid: 7 }), item({ pid: 8 })];
  assert.equal(ownQueuePlace(0, others, 99), undefined);
});

test('a window knows where its own reply sits in the line', () => {
  const shared = [item({ pid: 7 }), item({ pid: 99 }), item({ pid: 8 })];
  assert.deepEqual(ownQueuePlace(0, shared, 99), { position: 2, total: 3 });
});

test('a resume waiting here comes before anything shared', () => {
  assert.deepEqual(ownQueuePlace(1, [item({ pid: 7 })], 99), { position: 1, total: 2 });
});

test('the place counts every waiting item, not only this window\'s', () => {
  const shared = [item({ pid: 7 }), item({ pid: 8 }), item({ pid: 99 }), item({ pid: 99 })];
  assert.deepEqual(ownQueuePlace(0, shared, 99), { position: 3, total: 4 });
});

test('an unclaimed queue is free', () => {
  assert.equal(drainIsHeld(undefined, NOW, alive), false);
});

test('a claim held by a live window blocks others', () => {
  assert.equal(drainIsHeld({ pid: 1, at: NOW - MINUTE }, NOW, alive), true);
});

test('a claim from a window that died is released', () => {
  assert.equal(drainIsHeld({ pid: 1, at: NOW - MINUTE }, NOW, dead), false);
});

test('a claim held far too long is released, in case a window wedged', () => {
  assert.equal(drainIsHeld({ pid: 1, at: NOW - 60 * MINUTE }, NOW, alive), false);
});

// The rest run real processes against a real queue file, because the point of
// the locking is behaviour between processes and an in-process test cannot see
// an interleaved read-modify-write at all.

async function withTempHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'varterm-queue-'));
  try {
    return await fn(home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function queueFile(home) {
  return path.join(home, '.cursor', 'varterm-listen-queue.json');
}

function seedQueue(home, items) {
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.writeFileSync(queueFile(home), JSON.stringify({ items }), 'utf8');
}

function readQueueFile(home) {
  return JSON.parse(fs.readFileSync(queueFile(home), 'utf8'));
}

/** Runs one line of module code in a separate process with its own home. */
function runInChild(home, body) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', body], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  }).trim();
}

function spawnChild(home, script, index) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, HOME: home, USERPROFILE: home, CHILD_INDEX: String(index) },
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      err += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(out.trim());
      } else {
        reject(new Error(err || `child exited ${code}`));
      }
    });
  });
}

/**
 * Starts every child first and holds them at a shared start time, so they all
 * reach the queue at once. Running them one after another would pass whether or
 * not any locking existed.
 */
function childrenInParallel(home, body, count) {
  const startAt = Date.now() + 1500;
  const script = `
    import { popSharedQueue, pushSharedQueue } from ${JSON.stringify(MODULE)};
    const idle = new Int32Array(new SharedArrayBuffer(4));
    while (Date.now() < ${startAt}) { Atomics.wait(idle, 0, 0, 2); }
    ${body}
    // Stay open while the others act. A child that exits straight away looks
    // like a closed window, and the liveness checks would rightly ignore it.
    while (Date.now() < ${startAt + 1500}) { Atomics.wait(idle, 0, 0, 5); }
  `;
  return Promise.all(
    Array.from({ length: count }, (_, index) => spawnChild(home, script, index))
  );
}

test('only one window at a time reads from the shared queue', async () => {
  await withTempHome(async (home) => {
    // Five items and five idle windows. Without the claim each window takes a
    // different item and all five start talking over each other.
    seedQueue(
      home,
      Array.from({ length: 5 }, (_, i) => item({ id: `q-${i}`, text: `line ${i}`, pid: process.pid }))
    );

    const results = await childrenInParallel(
      home,
      "const got = popSharedQueue(0); console.log(got ? got.id : 'none');",
      5
    );

    const taken = results.filter((line) => line !== 'none');
    assert.equal(taken.length, 1, `expected one window to take an item, got ${results.join()}`);
  });
});

test('a window that exits mid read hands the queue back', async () => {
  await withTempHome(async (home) => {
    seedQueue(home, [item({ id: 'q-0', pid: process.pid })]);
    runInChild(
      home,
      `import { popSharedQueue } from ${JSON.stringify(MODULE)}; popSharedQueue(0);`
    );

    // The child claimed the queue and died without releasing it. The claim is
    // tied to the process, so the next window is not locked out.
    const after = runInChild(
      home,
      `import { sharedQueueBusyElsewhere } from ${JSON.stringify(MODULE)};
       console.log(sharedQueueBusyElsewhere());`
    );
    assert.equal(after, 'false');
  });
});

test('windows adding at the same moment do not overwrite each other', async () => {
  await withTempHome(async (home) => {
    seedQueue(home, []);

    await childrenInParallel(
      home,
      "pushSharedQueue({ text: 'reply ' + process.env.CHILD_INDEX, label: 'agent reply' }, 0);",
      8
    );

    // Read the file directly: the children have exited, so going through
    // readSharedQueue would prune everything they wrote.
    const { items } = readQueueFile(home);
    assert.equal(items.length, 8, `lost writes: ${items.map((i) => i.text).join()}`);
  });
});

test('the same reply offered by two windows is only queued once', async () => {
  await withTempHome(async (home) => {
    seedQueue(home, []);

    const results = await childrenInParallel(
      home,
      "console.log(pushSharedQueue({ text: 'same answer', label: 'agent reply' }, 0));",
      4
    );

    assert.equal(results.filter((line) => line === 'true').length, 1, results.join());
    assert.equal(readQueueFile(home).items.length, 1);
  });
});
