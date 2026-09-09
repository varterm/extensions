#!/usr/bin/env node
// The detached player. Reads text on stdin and speaks it.
//
// Runs outside the session's lifetime on purpose, so the reply keeps being read
// while you type the next prompt. It holds the cross-session lock for as long
// as it is speaking, and /varterm:stop kills it by pid.

import fs from 'node:fs';
import { join } from 'node:path';
import { readConfig } from './lib/config.mjs';
import { splitTextIntoChunks } from './lib/text.mjs';
import { audioDir, findPlayer, playFile, synthesize } from './lib/speech.mjs';
import { claim, release } from './lib/lock.mjs';

async function readStdin() {
  const parts = [];
  for await (const chunk of process.stdin) parts.push(chunk);
  return Buffer.concat(parts).toString('utf8');
}

const text = (await readStdin()).trim();
if (!text) process.exit(0);

const player = findPlayer();
if (!player) process.exit(0);

// Someone else is mid-sentence. Interrupting them would be worse than staying
// quiet, since neither reply would be understandable.
if (!claim(process.env.VARTERM_LABEL || 'claude-code')) process.exit(0);

const config = readConfig();
const chunks = splitTextIntoChunks(text, 450);
const dir = audioDir();
const written = [];
let current = null;

const cleanUp = () => {
  if (current) {
    try {
      current.kill();
    } catch {
      // Already gone.
    }
  }
  for (const file of written) {
    try {
      fs.unlinkSync(file);
    } catch {
      // Best effort.
    }
  }
  release();
};

process.on('SIGTERM', () => {
  cleanUp();
  process.exit(0);
});
process.on('SIGINT', () => {
  cleanUp();
  process.exit(0);
});

try {
  // One chunk ahead: the next clip is fetched while the current one plays, so
  // there is no gap between them.
  let pending = synthesize(chunks[0], config.voice, config.rate);

  for (let i = 0; i < chunks.length; i++) {
    const bytes = await pending;
    pending = i + 1 < chunks.length
      ? synthesize(chunks[i + 1], config.voice, config.rate).catch(() => null)
      : null;

    if (!bytes) break;

    const file = join(dir, `${process.pid}-${i}.mp3`);
    fs.writeFileSync(file, bytes);
    written.push(file);

    await playFile(file, player, (child) => {
      current = child;
    });
    current = null;
  }
} catch {
  // A network failure means silence, which is the right outcome for something
  // nobody asked for out loud.
} finally {
  cleanUp();
}

process.exit(0);
