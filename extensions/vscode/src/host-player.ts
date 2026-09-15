// Finding something on the machine that can play an MP3.
//
// macOS and Windows both ship with an answer. Linux ships with none, so the
// extension used to spawn ffplay and hope, which failed as "spawn ffplay
// ENOENT" on any machine without ffmpeg.
//
// Kept apart from extension.ts because none of it touches the editor, which
// means it can be tested directly. See tests/host-player.test.mjs.

import { accessSync, constants } from 'node:fs';
import * as path from 'node:path';

export type HostPlayer = {
  cmd: string;
  args: (file: string) => string[];
};

// Ordered by how likely the player is to already be installed. paplay and aplay
// are deliberately absent: both are WAV players and these clips are MP3.
export const LINUX_PLAYERS: HostPlayer[] = [
  { cmd: 'ffplay', args: (file) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', file] },
  { cmd: 'mpv', args: (file) => ['--no-video', '--really-quiet', file] },
  { cmd: 'mpg123', args: (file) => ['-q', file] },
  { cmd: 'mpg321', args: (file) => ['-q', file] },
  { cmd: 'cvlc', args: (file) => ['--intf', 'dummy', '--play-and-exit', '--quiet', file] },
  { cmd: 'gst-play-1.0', args: (file) => ['--quiet', file] },
  { cmd: 'play', args: (file) => ['-q', file] },
];

export const NO_PLAYER_MESSAGE =
  'No audio player was found. Varterm needs one of ffmpeg (ffplay), mpv, mpg123, VLC, ' +
  'or SoX on PATH to play sound on Linux. Installing ffmpeg is usually enough.';

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Every player is invoked by bare name, so only PATH decides what runs. Reading
// PATH directly rather than shelling out to `which` keeps this free of a shell.
export function findLinuxPlayer(pathValue = process.env.PATH || ''): HostPlayer | null {
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  return (
    LINUX_PLAYERS.find((player) =>
      dirs.some((dir) => isExecutable(path.join(dir, player.cmd)))
    ) || null
  );
}
