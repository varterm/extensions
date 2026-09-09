// Cross-session playback ownership.
//
// Two Claude Code sessions finishing at once would otherwise talk over each
// other, which is the same problem two editor windows had. Ported from
// extensions/vscode/src/playback-lock.ts, with one deliberate difference: an
// editor window claims playback because you pressed Play, so the last claim
// should win. Here nobody pressed anything, so a session that finds someone
// already speaking stays quiet rather than interrupting.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILE_NAME = 'claude-code-playing.json';

export function lockPath() {
  return path.join(os.homedir(), '.varterm', FILE_NAME);
}

// A killed session cannot clean up after itself, so liveness is checked against
// the process rather than a timeout. Signal 0 only probes.
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function currentOwner() {
  try {
    const owner = JSON.parse(fs.readFileSync(lockPath(), 'utf8'));
    if (!owner?.pid || !isAlive(owner.pid)) return null;
    return owner;
  } catch {
    return null;
  }
}

// Returns false when someone else is already speaking.
export function claim(label) {
  const owner = currentOwner();
  if (owner && owner.pid !== process.pid) return false;

  try {
    fs.mkdirSync(path.dirname(lockPath()), { recursive: true });
    fs.writeFileSync(
      lockPath(),
      `${JSON.stringify({ pid: process.pid, label, updatedAt: Date.now() })}\n`,
      'utf8'
    );
    return true;
  } catch {
    // A lock that cannot be written costs the hand-off, never the playback.
    return true;
  }
}

// Only ever clears our own claim, so finishing cannot silence a session that
// has since taken over.
export function release() {
  try {
    const owner = JSON.parse(fs.readFileSync(lockPath(), 'utf8'));
    if (owner?.pid === process.pid) fs.unlinkSync(lockPath());
  } catch {
    // Already gone, or someone else's.
  }
}

// Used by /varterm:stop, which has to reach a player it did not start.
export function stopOwner() {
  const owner = currentOwner();
  if (!owner) return false;
  try {
    process.kill(owner.pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}
