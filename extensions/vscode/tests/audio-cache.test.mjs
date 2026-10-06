// Covers the long-read FileSystemError that wrote chunk N into Cursor's
// vscode-userdata globalStorage and failed mid-way. Playback files now live
// under the OS temp directory, and prune must not delete files still in use.

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILT = join(ROOT, 'dist/audio-cache.js');

if (!existsSync(BUILT)) {
  console.error('dist/audio-cache.js is missing. Run: npx tsc -p .');
  process.exit(1);
}

const { filesToPrune, playbackAudioDir, PLAYBACK_AUDIO_DIR_NAME } = await import(BUILT);

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

const now = 1_000_000;
const files = [
  { path: '/tmp/a.mp3', mtime: now - 1000, size: 10 },
  { path: '/tmp/b.mp3', mtime: now - 2000, size: 10 },
  { path: '/tmp/c.mp3', mtime: now - 3000, size: 10 },
  { path: '/tmp/old.mp3', mtime: now - 10 * 60 * 60 * 1000, size: 10 },
];

check('playback dir is under the OS temp folder', playbackAudioDir().startsWith(os.tmpdir()));
check(
  'playback dir is per process so windows do not share files',
  playbackAudioDir().endsWith(`${PLAYBACK_AUDIO_DIR_NAME}/pid-${process.pid}`) ||
    playbackAudioDir().endsWith(`${PLAYBACK_AUDIO_DIR_NAME}\\pid-${process.pid}`)
);

check(
  'keeps the newest files up to the limit',
  filesToPrune(files, { maxFiles: 2, maxAgeHours: 0, now }).map((f) => f.path).join(',') ===
    '/tmp/c.mp3,/tmp/old.mp3',
  filesToPrune(files, { maxFiles: 2, maxAgeHours: 0, now })
    .map((f) => f.path)
    .join(',')
);

check(
  'expired files are pruned even under the count limit',
  filesToPrune(files, { maxFiles: 10, maxAgeHours: 1, now }).map((f) => f.path).join(',') ===
    '/tmp/old.mp3',
  filesToPrune(files, { maxFiles: 10, maxAgeHours: 1, now })
    .map((f) => f.path)
    .join(',')
);

const protectedSet = new Set(['/tmp/c.mp3', '/tmp/old.mp3']);
const pruned = filesToPrune(files, {
  maxFiles: 1,
  maxAgeHours: 1,
  now,
  protect: protectedSet,
});
check(
  'files still playing are never pruned',
  pruned.every((f) => !protectedSet.has(f.path)) && pruned.map((f) => f.path).join(',') === '/tmp/b.mp3',
  pruned.map((f) => f.path).join(',')
);

check(
  'zero max files still leaves protected ones alone',
  filesToPrune(files, { maxFiles: 0, maxAgeHours: 0, now, protect: new Set(['/tmp/a.mp3']) })
    .map((f) => f.path)
    .includes('/tmp/a.mp3') === false
);

let failed = 0;
for (const r of results) {
  console.log(`  ${r.pass ? 'pass' : 'FAIL'}  ${r.name}${r.pass ? '' : '  -> ' + r.detail}`);
  if (!r.pass) failed++;
}
console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
