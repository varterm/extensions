#!/usr/bin/env node
// Stop hook: reads the reply Claude just finished.
//
// This has to get out of the way fast. A Stop hook holds up the turn while it
// runs, so reading a paragraph here would leave you unable to type for as long
// as it took to say it. Instead the text is handed to a detached player and
// this exits immediately.
//
// The reply text arrives as last_assistant_message, which the hooks reference
// recommends over reading the transcript: the transcript file is written
// asynchronously and may not contain the final message yet.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from './lib/config.mjs';
import { stripForSpeech } from './lib/text.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

async function readStdin() {
  const parts = [];
  for await (const chunk of process.stdin) parts.push(chunk);
  return Buffer.concat(parts).toString('utf8');
}

// A hook that fails must never break the session, so everything below is
// advisory and exits 0 no matter what.
try {
  const raw = await readStdin();
  const event = raw ? JSON.parse(raw) : {};

  // Already looping because of a stop hook: say nothing, or it says it twice.
  if (event.stop_hook_active) process.exit(0);

  const config = readConfig();
  if (!config.enabled) process.exit(0);

  const text = stripForSpeech(event.last_assistant_message || '');
  if (!text) process.exit(0);

  // A reply that is mostly a long code block leaves little prose, and a very
  // long one is usually not something you want read at you in full.
  if (text.length > config.maxChars) process.exit(0);

  const child = spawn(process.execPath, [join(HERE, 'play.mjs')], {
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore'],
    env: { ...process.env, VARTERM_LABEL: event.session_id || 'claude-code' },
  });
  child.stdin.end(text);
  child.unref();
} catch {
  // Nothing here is worth interrupting a session over.
}

process.exit(0);
