// Cross-window listen queue.
//
// Each window used to keep its own in-memory queue, coordinated only by the
// playback lock. With several projects open that produced no ordering: whichever
// window noticed the speaker free first spoke next, regardless of which reply
// had been waiting longest. This file gives every window one ordered line.
//
// Audio never goes in here. Tracks are base64 in memory and resume items carry a
// playback offset that only means something in the window that paused, so the
// shared queue carries text and the popping window synthesises it.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type SharedQueueItem = {
  id: string;
  text: string;
  label: string;
  /** The window that enqueued it, used to expire the queue once none are left. */
  pid: number;
  /** Project the reply came from, shown in the queue picker. */
  origin?: string;
  enqueuedAt: number;
};

/**
 * The window currently working through the queue. Popping and claiming have to
 * happen together: the playback lock is only published once audio starts, so
 * between popping and the first sound there is a synthesis gap in which another
 * idle window would see a free speaker, pop the next item and talk over it.
 */
export type QueueDrain = { pid: number; at: number };

type QueueFile = { items?: SharedQueueItem[]; draining?: QueueDrain };

/** Long enough for any single reply, short enough to recover from a wedge. */
const DRAIN_MAX_MS = 15 * 60 * 1000;

const FILE_NAME = 'varterm-listen-queue.json';
const LOCK_NAME = 'varterm-listen-queue.lock';
/** A held lock means another window is mid write, which takes microseconds. */
const LOCK_ATTEMPTS = 40;
const LOCK_STALE_MS = 2000;

export function listenQueuePath(): string {
  return path.join(os.homedir(), '.cursor', FILE_NAME);
}

function lockPath(): string {
  return path.join(os.homedir(), '.cursor', LOCK_NAME);
}

// A window that was killed cannot clean up after itself, so liveness is checked
// against the process rather than a timeout. Signal 0 only probes.
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Drops malformed entries and anything that has waited past its welcome. */
export function pruneQueueItems(
  items: SharedQueueItem[],
  now: number,
  ttlMs: number
): SharedQueueItem[] {
  return items.filter((item) => {
    if (!item?.text || typeof item.enqueuedAt !== 'number' || !item.pid) {
      return false;
    }
    return ttlMs <= 0 || now - item.enqueuedAt <= ttlMs;
  });
}

/**
 * Whether the queue was left behind by a session that has since ended.
 *
 * This is how the queue clears on restart without any window having to tidy up
 * on its way out. Liveness is judged across the whole queue rather than item by
 * item on purpose: closing one project window should not silently discard what
 * it queued while other windows are still there to read it.
 */
export function queueIsAbandoned(
  items: SharedQueueItem[],
  isAlive: (pid: number) => boolean = processIsAlive
): boolean {
  return items.length > 0 && !items.some((item) => isAlive(item.pid));
}

/** Everything a window should still consider reading. */
export function usableQueueItems(
  items: SharedQueueItem[],
  now: number,
  ttlMs: number,
  isAlive: (pid: number) => boolean = processIsAlive
): SharedQueueItem[] {
  const fresh = pruneQueueItems(items, now, ttlMs);
  return queueIsAbandoned(fresh, isAlive) ? [] : fresh;
}

/** The queue holds one copy of any given text, however many windows offer it. */
export function queueHasText(items: SharedQueueItem[], text: string): boolean {
  const needle = text.trim();
  return items.some((item) => item.text === needle);
}

/**
 * Where this window's own reply sits in the line, or nothing if it has none
 * waiting. Any free window may read a shared item, but the window that queued it
 * is the one whose answer it is, and the one whose mark should show it waiting.
 *
 * Local items are counted first because they are read first.
 */
export function ownQueuePlace(
  localCount: number,
  shared: SharedQueueItem[],
  pid: number
): { position: number; total: number } | undefined {
  const total = localCount + shared.length;
  if (localCount > 0) {
    return { position: 1, total };
  }
  const index = shared.findIndex((item) => item.pid === pid);
  return index < 0 ? undefined : { position: index + 1, total };
}

export function makeQueueId(pid: number, now: number, seq: number): string {
  return `q-${pid}-${now}-${seq}`;
}

/** True while a live window is still working through the queue. */
export function drainIsHeld(
  draining: QueueDrain | undefined,
  now: number,
  isAlive: (pid: number) => boolean = processIsAlive
): draining is QueueDrain {
  if (!draining?.pid) {
    return false;
  }
  if (now - draining.at > DRAIN_MAX_MS) {
    return false;
  }
  return isAlive(draining.pid);
}

function readRaw(): QueueFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(listenQueuePath(), 'utf8')) as QueueFile;
    return {
      items: Array.isArray(parsed?.items) ? parsed.items : [],
      draining: parsed?.draining,
    };
  } catch {
    return { items: [] };
  }
}

function writeRaw(file: QueueFile): void {
  const target = listenQueuePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Write then rename so a reader never sees a half written file.
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(file)}\n`, 'utf8');
  fs.renameSync(temp, target);
}

function sleepBriefly(): void {
  // Synchronous on purpose: the lock has to be held across a read and a write,
  // and awaiting in between would let this window's own timers interleave.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
}

/**
 * Runs a read-modify-write with the queue file to itself. Without this two
 * windows popping at the same moment both read the same head item and both
 * speak it.
 */
function withQueueLock<T>(fn: () => T, fallback: T): T {
  const lock = lockPath();
  fs.mkdirSync(path.dirname(lock), { recursive: true });

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      fs.writeFileSync(lock, `${process.pid}\n`, { flag: 'wx' });
    } catch {
      // A window killed mid write leaves the lock behind, so it is only honoured
      // while it is fresh.
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lock);
        }
      } catch {
        // Someone else cleared it first.
      }
      sleepBriefly();
      continue;
    }

    try {
      return fn();
    } finally {
      try {
        fs.unlinkSync(lock);
      } catch {
        // Already cleared.
      }
    }
  }

  return fallback;
}

/** Keeps a live drain claim, drops a dead or expired one. */
function survivingDrain(draining: QueueDrain | undefined, now: number): QueueDrain | undefined {
  return drainIsHeld(draining, now) ? draining : undefined;
}

export function readSharedQueue(ttlMs: number): SharedQueueItem[] {
  return usableQueueItems(readRaw().items ?? [], Date.now(), ttlMs);
}

/** True when a different live window is already working through the queue. */
export function sharedQueueBusyElsewhere(): boolean {
  const draining = survivingDrain(readRaw().draining, Date.now());
  return Boolean(draining && draining.pid !== process.pid);
}

/** Returns false when the text is already waiting or already being read. */
export function pushSharedQueue(
  item: Omit<SharedQueueItem, 'id' | 'pid' | 'enqueuedAt'>,
  ttlMs: number
): boolean {
  const text = item.text.trim();
  if (!text) {
    return false;
  }
  return withQueueLock(() => {
    const now = Date.now();
    const file = readRaw();
    const items = usableQueueItems(file.items ?? [], now, ttlMs);
    const draining = survivingDrain(file.draining, now);
    if (queueHasText(items, text)) {
      writeRaw({ items, draining });
      return false;
    }
    items.push({
      ...item,
      text,
      id: makeQueueId(process.pid, now, items.length),
      pid: process.pid,
      enqueuedAt: now,
    });
    writeRaw({ items, draining });
    return true;
  }, false);
}

/**
 * Takes the next item and claims the queue in the same locked write, so exactly
 * one window is ever reading from it. Returns nothing while another live window
 * holds the claim, even if items are waiting.
 */
export function popSharedQueue(ttlMs: number): SharedQueueItem | undefined {
  return withQueueLock(() => {
    const now = Date.now();
    const file = readRaw();
    const items = usableQueueItems(file.items ?? [], now, ttlMs);
    const draining = survivingDrain(file.draining, now);
    if (draining && draining.pid !== process.pid) {
      writeRaw({ items, draining });
      return undefined;
    }
    const next = items.shift();
    writeRaw({ items, draining: next ? { pid: process.pid, at: now } : undefined });
    return next;
  }, undefined);
}

export function holdsSharedDrain(): boolean {
  return readRaw().draining?.pid === process.pid;
}

/** Hands the queue to whichever window wants it next. Only clears our own claim. */
export function releaseSharedDrain(): void {
  // Checked before taking the lock because this is called on every drop to
  // idle, and almost always there is nothing to release.
  if (!holdsSharedDrain()) {
    return;
  }
  withQueueLock(() => {
    const file = readRaw();
    if (file.draining?.pid !== process.pid) {
      return;
    }
    writeRaw({ items: file.items ?? [], draining: undefined });
  }, undefined);
}

export function removeSharedQueueItem(id: string, ttlMs: number): void {
  withQueueLock(() => {
    const now = Date.now();
    const file = readRaw();
    const items = usableQueueItems(file.items ?? [], now, ttlMs).filter((item) => item.id !== id);
    writeRaw({ items, draining: survivingDrain(file.draining, now) });
  }, undefined);
}

export function clearSharedQueue(): void {
  withQueueLock(() => writeRaw({ items: [] }), undefined);
}

/**
 * Calls back when another window may have changed the queue. fs.watch misses
 * events on some setups, so a slow poll backs it up, and the poll doubles as the
 * thing that notices items ageing out.
 */
export function watchListenQueue(onChange: () => void): { dispose: () => void } {
  const dirPath = path.dirname(listenQueuePath());
  fs.mkdirSync(dirPath, { recursive: true });

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const fire = (): void => {
    if (debounce) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(onChange, 60);
  };

  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(dirPath, (_event, filename) => {
      if (filename && filename.toString() === FILE_NAME) {
        fire();
      }
    });
  } catch {
    // Fall back to polling alone.
  }

  const poll = setInterval(onChange, 5000);

  return {
    dispose: () => {
      if (debounce) {
        clearTimeout(debounce);
      }
      clearInterval(poll);
      watcher?.close();
    },
  };
}
