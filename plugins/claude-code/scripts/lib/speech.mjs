// Text in, sound out.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ENDPOINT = 'https://www.varterm.com/api/edge-tts';

// Public endpoint, no key. It answers with MP3 bytes, never with anything that
// gets executed.
export async function synthesize(text, voice, rate) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, rate }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Varterm TTS ${response.status}: ${detail.slice(0, 200)}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 128) throw new Error('Varterm TTS returned no audio');
  return bytes;
}

// Whichever of these exists. Each one plays a file and exits when it is done,
// which is what makes the queue below sequential.
//
// All of them decode MP3, which is what the endpoint returns. aplay and paplay
// used to be here and should not have been: aplay handles WAV and raw only, and
// paplay only learned MP3 in libsndfile 1.1.0, so on an older machine with
// neither ffplay nor mpv they were picked and then failed.
const PLAYERS = [
  { cmd: 'afplay', args: (file) => [file] },
  { cmd: 'ffplay', args: (file) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', file] },
  { cmd: 'mpv', args: (file) => ['--no-video', '--really-quiet', file] },
  { cmd: 'mpg123', args: (file) => ['-q', file] },
  { cmd: 'mpg321', args: (file) => ['-q', file] },
  { cmd: 'cvlc', args: (file) => ['--intf', 'dummy', '--play-and-exit', '--quiet', file] },
  { cmd: 'gst-play-1.0', args: (file) => ['--quiet', file] },
  { cmd: 'play', args: (file) => ['-q', file] },
];

function onPath(cmd) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  return dirs.some((dir) => {
    try {
      fs.accessSync(path.join(dir, cmd), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function findPlayer() {
  return PLAYERS.find((player) => onPath(player.cmd)) || null;
}

export function playFile(file, player, onProcess) {
  return new Promise((resolve, reject) => {
    const child = spawn(player.cmd, player.args(file), { stdio: 'ignore' });
    if (onProcess) onProcess(child);
    child.on('error', reject);
    child.on('exit', () => resolve());
  });
}

export function audioDir() {
  const dir = path.join(os.tmpdir(), 'varterm-claude-code');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
