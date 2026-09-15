// Covers "spawn ffplay ENOENT", reported from a Linux install. The extension
// assumed ffmpeg was present and spawned ffplay unconditionally, so any machine
// without it got a raw ENOENT and no sound.
//
// These build real directories of fake executables and point PATH at them, so
// the executable-bit check is exercised rather than mocked.
//
// Run with: npm test

import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILT = join(ROOT, 'dist/host-player.js');

if (!existsSync(BUILT)) {
  console.error('dist/host-player.js is missing. Run: npx tsc -p .');
  process.exit(1);
}

const { findLinuxPlayer, LINUX_PLAYERS, NO_PLAYER_MESSAGE } = await import(BUILT);

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

const temps = [];
// `executable` off mimics a file that exists but cannot be run, which is the
// case a plain existence check would get wrong.
function pathWith(commands, { executable = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'varterm-player-'));
  temps.push(dir);
  for (const cmd of commands) {
    const file = join(dir, cmd);
    writeFileSync(file, '#!/bin/sh\nexit 0\n');
    chmodSync(file, executable ? 0o755 : 0o644);
  }
  return dir;
}

try {
  // --- picks whatever is installed -------------------------------------------
  for (const player of LINUX_PLAYERS) {
    const found = findLinuxPlayer(pathWith([player.cmd]));
    check(`finds ${player.cmd} when it is the only one`, found?.cmd === player.cmd, String(found?.cmd));
  }

  // --- nothing installed is reported, not guessed ------------------------------
  check('returns null on an empty PATH', findLinuxPlayer('') === null);
  check('returns null when PATH has no player', findLinuxPlayer(pathWith(['git', 'node'])) === null);
  check('returns null for non-existent directories', findLinuxPlayer('/no/such/dir') === null);
  check('message names ffmpeg', NO_PLAYER_MESSAGE.includes('ffmpeg'));
  check('message names the alternatives',
    ['mpv', 'mpg123', 'VLC', 'SoX'].every((n) => NO_PLAYER_MESSAGE.includes(n)));

  // --- a file that is not executable does not count ----------------------------
  check('ignores a non-executable ffplay',
    findLinuxPlayer(pathWith(['ffplay'], { executable: false })) === null);
  const mixed = [pathWith(['ffplay'], { executable: false }), pathWith(['mpv'])].join(delimiter);
  check('falls past a non-executable ffplay to mpv', findLinuxPlayer(mixed)?.cmd === 'mpv',
    String(findLinuxPlayer(mixed)?.cmd));

  // --- preference order --------------------------------------------------------
  const all = pathWith(LINUX_PLAYERS.map((p) => p.cmd));
  check('prefers ffplay when everything is installed', findLinuxPlayer(all)?.cmd === 'ffplay',
    String(findLinuxPlayer(all)?.cmd));
  const noFfplay = pathWith(LINUX_PLAYERS.slice(1).map((p) => p.cmd));
  check('falls back to mpv without ffplay', findLinuxPlayer(noFfplay)?.cmd === 'mpv',
    String(findLinuxPlayer(noFfplay)?.cmd));
  const onlyLast = pathWith(['play']);
  check('reaches the last player in the list', findLinuxPlayer(onlyLast)?.cmd === 'play');

  // Earlier directories on PATH win, matching how a shell resolves a command.
  const order = [pathWith(['mpv']), pathWith(['ffplay'])].join(delimiter);
  check('list order decides, not PATH order', findLinuxPlayer(order)?.cmd === 'ffplay',
    String(findLinuxPlayer(order)?.cmd));

  // --- the arguments have to name the file -------------------------------------
  for (const player of LINUX_PLAYERS) {
    const args = player.args('/tmp/clip.mp3');
    check(`${player.cmd} passes the file`, args.includes('/tmp/clip.mp3'), JSON.stringify(args));
    check(`${player.cmd} takes no shell string`, args.every((a) => typeof a === 'string'));
  }

  // WAV-only players would play noise or fail on an MP3.
  check('no WAV-only players are offered',
    !LINUX_PLAYERS.some((p) => ['aplay', 'paplay'].includes(p.cmd)));
  check('empty PATH segments are skipped', findLinuxPlayer(`${delimiter}${delimiter}`) === null);
} finally {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
}

let failed = 0;
for (const r of results) {
  console.log(`  ${r.pass ? 'pass' : 'FAIL'}  ${r.name}${r.pass ? '' : '  -> ' + r.detail}`);
  if (!r.pass) failed++;
}
console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
