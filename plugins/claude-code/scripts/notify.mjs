#!/usr/bin/env node
// Notification hook: says out loud when Claude is waiting on you.
//
// Off by default. Useful when you leave a long run going and want to know it
// needs a permission decision without watching the terminal.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from './lib/config.mjs';
import { currentOwner } from './lib/lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const SPOKEN = {
  permission_prompt: 'Claude needs permission to continue.',
  idle_prompt: 'Claude is waiting for you.',
  agent_needs_input: 'Claude needs your input.',
};

async function readStdin() {
  const parts = [];
  for await (const chunk of process.stdin) parts.push(chunk);
  return Buffer.concat(parts).toString('utf8');
}

try {
  const raw = await readStdin();
  const event = raw ? JSON.parse(raw) : {};

  const config = readConfig();
  if (!config.enabled || !config.notify) process.exit(0);

  // Cutting into a reply being read to announce a prompt helps nobody.
  if (currentOwner()) process.exit(0);

  const message = SPOKEN[event.notification_type] || SPOKEN[event.matcher];
  if (!message) process.exit(0);

  const child = spawn(process.execPath, [join(HERE, 'play.mjs')], {
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore'],
    env: { ...process.env, VARTERM_LABEL: 'notification' },
  });
  child.stdin.end(message);
  child.unref();
} catch {
  // Advisory only.
}

process.exit(0);
