// Host players (afplay, PowerShell, ffplay) need real files on disk. Those used
// to go through vscode.workspace.fs into Cursor's vscode-userdata globalStorage.
// That provider fails mid-read on long selections with an opaque
// FileSystemError, and every Cursor window shares the same folder so one
// window's prune can race another window's writes.
//
// Playback files therefore live under the OS temp directory and are written
// with Node's fs. globalStorage/audio is only swept for leftovers from older
// builds that still wrote there.

import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';

export const PLAYBACK_AUDIO_DIR_NAME = 'varterm-cursor-audio';

export function playbackAudioRoot(): string {
  return path.join(os.tmpdir(), PLAYBACK_AUDIO_DIR_NAME);
}

export function playbackAudioDir(pid = process.pid): string {
  return path.join(playbackAudioRoot(), `pid-${pid}`);
}

export function legacyAudioDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'audio');
}

export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeAudioBytes(filePath: string, bytes: Uint8Array): Promise<void> {
  await ensureDir(path.dirname(filePath));
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(filePath, bytes);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export type CachedAudio = { path: string; mtime: number; size: number };

export async function listMp3Files(dir: string): Promise<CachedAudio[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: CachedAudio[] = [];
  for (const name of names) {
    if (!name.endsWith('.mp3')) {
      continue;
    }
    const filePath = path.join(dir, name);
    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        continue;
      }
      out.push({ path: filePath, mtime: info.mtimeMs, size: info.size });
    } catch {
      // Gone between readdir and stat.
    }
  }
  return out;
}

export function filesToPrune(
  files: CachedAudio[],
  options: {
    maxFiles: number;
    maxAgeHours: number;
    now?: number;
    protect?: ReadonlySet<string>;
  }
): CachedAudio[] {
  const now = options.now ?? Date.now();
  const protect = options.protect ?? new Set<string>();
  const safeMaxFiles = Math.max(0, Math.min(200, options.maxFiles));
  const maxAgeHours = Math.max(0, Math.min(24 * 90, options.maxAgeHours));

  const candidates = files.filter((file) => !protect.has(file.path));
  const expired =
    maxAgeHours > 0
      ? candidates.filter((file) => now - file.mtime > maxAgeHours * 60 * 60 * 1000)
      : [];
  const expiredPaths = new Set(expired.map((file) => file.path));
  const remaining = candidates
    .filter((file) => !expiredPaths.has(file.path))
    .sort((a, b) => b.mtime - a.mtime);
  return [...expired, ...remaining.slice(safeMaxFiles)];
}

export async function deleteFiles(paths: string[]): Promise<number> {
  let deleted = 0;
  await Promise.all(
    paths.map(async (filePath) => {
      try {
        await unlink(filePath);
        deleted += 1;
      } catch {
        // Already gone, or still open on Windows.
      }
    })
  );
  return deleted;
}
