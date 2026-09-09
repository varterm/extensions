// Checks the plugin without needing Claude Code or a network.
//
// The hook is the part that must never misbehave: it runs on every turn, and a
// hook that throws or hangs is worse than one that does nothing. So it is run
// for real here, with fabricated Stop payloads, and the player it would spawn
// is replaced by a stub that records what it was asked to say.
//
// Run with: node tests/plugin.test.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripForSpeech, splitTextIntoChunks } from '../scripts/lib/text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

// --- manifest and layout -----------------------------------------------------

const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
check('plugin name is kebab-case', /^[a-z][a-z0-9-]*$/.test(manifest.name), manifest.name);
check('declares a version', !!manifest.version);
check('offers voice and rate as options',
  !!manifest.user_config?.voice && !!manifest.user_config?.rate);

// The marketplace file is what makes the plugin installable, and it lives two
// levels up, so it is easy to change one and forget the other.
const MARKET_ROOT = join(ROOT, '../..');
const market = JSON.parse(readFileSync(join(MARKET_ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
const listing = (market.plugins || []).find((p) => p.name === manifest.name);
check('marketplace lists this plugin', !!listing, JSON.stringify(market.plugins));
check('marketplace name is not one Anthropic reserves',
  !['claude-plugins-community', 'claude-code-plugins', 'anthropic-plugins', 'claude-community']
    .includes(market.name),
  market.name);
check('marketplace source points at this directory',
  listing && existsSync(join(MARKET_ROOT, listing.source, '.claude-plugin/plugin.json')),
  listing?.source);

const hooks = JSON.parse(readFileSync(join(ROOT, 'hooks/hooks.json'), 'utf8'));
const stop = hooks.hooks?.Stop?.[0]?.hooks?.[0];
check('registers a Stop hook', !!stop);
check('Stop hook uses exec form so paths with spaces survive', Array.isArray(stop?.args));
check('Stop hook has a timeout', typeof stop?.timeout === 'number');

for (const [event, entry] of Object.entries(hooks.hooks || {})) {
  const script = entry[0]?.hooks?.[0]?.args?.[0]?.replace('${CLAUDE_PLUGIN_ROOT}/', '');
  check(`${event} hook points at a file that exists`, script && existsSync(join(ROOT, script)), script);
}

for (const file of ['on', 'off', 'stop', 'voice', 'status']) {
  const path = join(ROOT, 'commands', `${file}.md`);
  check(`/${file} command exists`, existsSync(path));
  if (existsSync(path)) {
    check(`/${file} resolves the script by plugin root`,
      readFileSync(path, 'utf8').includes('${CLAUDE_PLUGIN_ROOT}'));
  }
}

// --- text handling -----------------------------------------------------------

const reply = [
  '# A heading',
  '',
  'Here is `inline code` and a [link](https://example.com).',
  '',
  '```js',
  'const secret = 1;',
  '```',
  '',
  'The last paragraph.',
].join('\n');

const spoken = stripForSpeech(reply);
check('drops fenced code', !spoken.includes('const secret'), spoken);
check('keeps inline code as words', spoken.includes('inline code'));
check('reads link text, not the url', spoken.includes('link') && !spoken.includes('example.com'));
check('drops heading marks', !spoken.includes('#'));

const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} goes here.`).join(' ');
const chunks = splitTextIntoChunks(long, 450);
check('splits long text', chunks.length > 1, `${chunks.length} chunks`);
check('no chunk exceeds the limit', chunks.every((c) => c.length <= 450),
  String(Math.max(...chunks.map((c) => c.length))));
check('splitting loses no words',
  chunks.join(' ').replace(/\s+/g, ' ') === long.replace(/\s+/g, ' '));
check('empty text produces nothing', splitTextIntoChunks('').length === 0);

// --- the hook, run for real --------------------------------------------------

// A stub standing in for play.mjs. The hook spawns it detached, so it writes
// what it was given to a file the test can read afterwards.
const sandbox = mkdtempSync(join(tmpdir(), 'varterm-plugin-'));
const home = join(sandbox, 'home');
mkdirSync(join(home, '.varterm'), { recursive: true });
const spokenLog = join(sandbox, 'spoken.txt');

const scripts = join(sandbox, 'scripts');
mkdirSync(join(scripts, 'lib'), { recursive: true });
for (const file of ['lib/config.mjs', 'lib/text.mjs', 'lib/lock.mjs', 'speak.mjs']) {
  writeFileSync(join(scripts, file), readFileSync(join(ROOT, 'scripts', file)));
}
writeFileSync(
  join(scripts, 'play.mjs'),
  `import fs from 'node:fs';
   const parts = [];
   for await (const chunk of process.stdin) parts.push(chunk);
   fs.appendFileSync(${JSON.stringify(spokenLog)}, Buffer.concat(parts).toString() + '\\n---\\n');`
);

// `expectSilence` only shortens the wait. Proving nothing was said means
// waiting out a window in which it could have been, so that window is kept
// short when silence is what we are checking for.
function runHook(event, config = {}, expectSilence = false) {
  writeFileSync(
    join(home, '.varterm', 'claude-code.json'),
    JSON.stringify({ enabled: true, voice: 'en-US-EmmaNeural', rate: 1, maxChars: 4000, ...config })
  );
  try {
    rmSync(spokenLog);
  } catch {
    // First run.
  }

  execFileSync(process.execPath, [join(scripts, 'speak.mjs')], {
    input: JSON.stringify(event),
    env: { ...process.env, HOME: home, USERPROFILE: home },
    timeout: 10000,
  });

  // The player is detached, so give it a moment to write. Nothing here is
  // async, so the wait has to block the thread.
  const deadline = Date.now() + (expectSilence ? 400 : 1500);
  while (Date.now() < deadline && !existsSync(spokenLog)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  return existsSync(spokenLog) ? readFileSync(spokenLog, 'utf8') : '';
}

const base = {
  session_id: 'test',
  hook_event_name: 'Stop',
  stop_hook_active: false,
  last_assistant_message: 'The change is in and the tests pass.',
};

check('reads a finished reply', runHook(base).includes('The change is in'));
check('says nothing when switched off', runHook(base, { enabled: false }, true) === '');
check('says nothing on a stop-hook loop',
  runHook({ ...base, stop_hook_active: true }, {}, true) === '');
check('says nothing when there is no message',
  runHook({ ...base, last_assistant_message: '' }, {}, true) === '');
check('skips a reply longer than the limit',
  runHook({ ...base, last_assistant_message: 'x '.repeat(3000) }, { maxChars: 200 }, true) === '');
check('skips a reply that is only code',
  runHook({ ...base, last_assistant_message: '```\nconst a = 1;\n```' }, {}, true) === '');

// The hook must survive anything, since a crash here interrupts the session.
let survived = true;
for (const junk of ['', 'not json at all', '{"last_assistant_message":null}', '{}']) {
  try {
    execFileSync(process.execPath, [join(scripts, 'speak.mjs')], {
      input: junk,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      timeout: 10000,
    });
  } catch (error) {
    survived = false;
    check('hook survives malformed input', false, `${JSON.stringify(junk)}: ${error.message}`);
  }
}
if (survived) check('hook survives malformed input', true);

rmSync(sandbox, { recursive: true, force: true });

let failed = 0;
for (const r of results) {
  console.log(`  ${r.pass ? 'pass' : 'FAIL'}  ${r.name}${r.pass ? '' : '  -> ' + r.detail}`);
  if (!r.pass) failed++;
}
console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
