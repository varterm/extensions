// Cross-window playback ownership.
//
// Playback state is per-window, so without this every other Cursor window
// believes nothing is playing: its status bar shows Play, and pressing it reads
// the same agent reply a second time, overlapping the window that is already
// speaking. One shared file makes the current owner visible to all of them.
//
// Ownership is claimed rather than negotiated: the last window to start playing
// wins and the previous owner stops itself. That keeps pressing Play doing what
// it looks like it does, in whichever window you press it.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type PlaybackOwner = {
  pid: number;
  state: 'playing' | 'paused';
  label: string;
  updatedAt: number;
  /** When false, other windows should not yield. Auto-read must not steal. */
  steal?: boolean;
};

const FILE_NAME = 'varterm-playing.json';

export function playbackLockPath(): string {
  return path.join(os.homedir(), '.cursor', FILE_NAME);
}

// A window that was killed cannot clean up after itself, so liveness is checked
// against the process rather than a timeout. Signal 0 only probes.
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readPlaybackOwner(): PlaybackOwner | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(playbackLockPath(), 'utf8')) as PlaybackOwner;
    if (!parsed?.pid || !isAlive(parsed.pid)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function claimPlayback(
  state: 'playing' | 'paused',
  label: string,
  steal = true
): void {
  const owner: PlaybackOwner = { pid: process.pid, state, label, updatedAt: Date.now(), steal };
  try {
    fs.mkdirSync(path.dirname(playbackLockPath()), { recursive: true });
    fs.writeFileSync(playbackLockPath(), `${JSON.stringify(owner)}\n`, 'utf8');
  } catch {
    // A missing lock only costs the cross-window hand-off, never playback.
  }
}

// Only ever clears our own claim, so a window shutting down cannot silence a
// different window that has since taken over.
export function releasePlayback(): void {
  try {
    const parsed = JSON.parse(fs.readFileSync(playbackLockPath(), 'utf8')) as PlaybackOwner;
    if (parsed?.pid === process.pid) {
      fs.unlinkSync(playbackLockPath());
    }
  } catch {
    // Already gone, or owned by someone else.
  }
}

export function ownedByAnotherWindow(owner: PlaybackOwner | undefined): owner is PlaybackOwner {
  return Boolean(owner && owner.pid !== process.pid);
}

/**
 * Calls back whenever the owning window may have changed. fs.watch misses
 * events on some setups, so a slow poll backs it up; both paths are cheap
 * because the payload is one small file.
 */
export function watchPlaybackLock(onChange: () => void): { dispose: () => void } {
  const dirPath = path.dirname(playbackLockPath());
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
