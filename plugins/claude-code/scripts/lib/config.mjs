// Settings live in a file rather than in the plugin config alone, because
// /varterm:on and /varterm:off have to change them from a Bash call that does
// not receive the plugin's own environment. Plugin options still supply the
// defaults, so configuring the plugin the normal way works.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULTS = {
  enabled: true,
  voice: 'en-US-EmmaNeural',
  rate: 1,
  maxChars: 4000,
  notify: false,
};

export function configPath() {
  return path.join(os.homedir(), '.varterm', 'claude-code.json');
}

function fromPluginOptions() {
  const options = {};
  const { CLAUDE_PLUGIN_OPTION_VOICE, CLAUDE_PLUGIN_OPTION_RATE, CLAUDE_PLUGIN_OPTION_MAX_CHARS } =
    process.env;

  if (CLAUDE_PLUGIN_OPTION_VOICE) options.voice = CLAUDE_PLUGIN_OPTION_VOICE;
  if (CLAUDE_PLUGIN_OPTION_RATE) options.rate = Number(CLAUDE_PLUGIN_OPTION_RATE);
  if (CLAUDE_PLUGIN_OPTION_MAX_CHARS) options.maxChars = Number(CLAUDE_PLUGIN_OPTION_MAX_CHARS);

  for (const [key, value] of Object.entries(options)) {
    if (typeof value === 'number' && !Number.isFinite(value)) delete options[key];
  }
  return options;
}

export function readConfig() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    // No file yet, or unreadable. Defaults apply.
  }
  return { ...DEFAULTS, ...fromPluginOptions(), ...saved };
}

export function writeConfig(changes) {
  const next = { ...readConfig(), ...changes };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
