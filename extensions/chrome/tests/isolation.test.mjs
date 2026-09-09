// Proves the site adapters cannot interfere with each other.
//
// YouTube and claude.ai each get their own helper file, but they share all of
// content.js, and content.js now contains code for both. A page only ever
// receives the helper for the site it is on, so every reference content.js
// makes to the other site's helper has to be inert rather than throwing.
//
// Reading the guards is not enough to know that. Here each page's exact
// injection list is loaded into a real browser, in order, and the result is
// checked: no exception, the right helper present, the other one absent, and
// the entry points for the missing helper failing quietly.
//
// Run with: node tests/isolation.test.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome } from './cdp.mjs';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!findChrome()) {
  console.log('skipped: no Chrome found (set CHROME to run these)');
  process.exit(0);
}

// Just enough of the extension APIs for content.js to load. getSettings has to
// answer, because that callback is what starts the Claude setup.
const CHROME_STUB = `
  window.__sent = [];
  window.__intervals = 0;
  window.__realSetInterval = window.setInterval;
  window.setInterval = (...args) => { window.__intervals++; return window.__realSetInterval(...args); };
  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage: (message, callback) => {
        window.__sent.push(message);
        if (message.action === 'getSettings' && callback) {
          callback({ voiceTier: 'cloud', voice: 'en-US-EmmaNeural', rate: 1,
                     stripMarkdown: true, autoReadClaude: true, autoReadChatgpt: true });
        }
      },
      onMessage: { addListener: (fn) => { window.__onMessage = fn; } },
    },
    storage: {
      sync: { get: (d, cb) => cb && cb(d), set: (v, cb) => cb && cb() },
      onChanged: { addListener: (fn) => { window.__onChanged = fn; } },
    },
  };
  true;
`;

// The lists background.js builds, kept in step by the check at the end.
const PAGES = {
  youtube: ['voices.js', 'panel.js', 'youtube.js', 'content.js'],
  claude: ['voices.js', 'panel.js', 'claude.js', 'content.js'],
  chatgpt: ['voices.js', 'panel.js', 'chats.js', 'content.js'],
  ordinary: ['voices.js', 'panel.js', 'content.js'],
};

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

// content.js declares its state with let and const, so loading it twice in one
// context throws on the re-declaration. Every page gets its own browser, which
// is what a real page load gives it anyway.
for (const [page, files] of Object.entries(PAGES)) {
  const session = await launchChrome();
  try {
    await session.evaluate(CHROME_STUB);

    let loadError = '';
    for (const file of files) {
      try {
        await session.evaluate(readFileSync(join(EXT, file), 'utf8'));
      } catch (error) {
        loadError = `${file}: ${error.message}`;
        break;
      }
    }
    check(`${page}: its script list loads without throwing`, !loadError, loadError);
    if (loadError) continue;


    // Let the getSettings callback run, since that is what calls setUpClaude.
    const state = await session.evaluate(`(async () => {
      await new Promise((r) => setTimeout(r, 80));
      return {
        hasYouTube: typeof vartermGetYouTubeTranscript === 'function',
        hasClaude: typeof vartermIsClaude === 'function',
        hasChat: typeof vartermChatActive === 'function',
        chatHere: typeof vartermChatActive === 'function' && !!vartermChatActive(),
        hasPanel: typeof vartermPanelOpen === 'function',
        hasReader: typeof reader === 'object',
        intervals: window.__intervals,
        settingsAsked: window.__sent.some((m) => m.action === 'getSettings'),
      };
    })()`, true);

    check(`${page}: reader panel is available`, state.hasPanel);
    check(`${page}: shared reader state is intact`, state.hasReader);
    check(`${page}: settings still load`, state.settingsAsked);
    check(`${page}: has the YouTube helper only where it should`,
      state.hasYouTube === (page === 'youtube'), `hasYouTube=${state.hasYouTube}`);
    check(`${page}: has the Claude helper only where it should`,
      state.hasClaude === (page === 'claude'), `hasClaude=${state.hasClaude}`);
    check(`${page}: has the chat helper only where it should`,
      state.hasChat === (page === 'chatgpt'), `hasChat=${state.hasChat}`);
    check(`${page}: chat adapters stay idle on this test host`,
      !state.chatHere, `chatHere=${state.chatHere}`);

    // Button top-up polls only when the helper matches the page. Claude matches
    // only on claude.ai; the blank test page is not a chat host, so chats.js
    // must not start a timer even when it is the file that was injected.
    if (page !== 'claude') {
      check(`${page}: starts no site polling`, state.intervals === 0,
        `${state.intervals} intervals`);
    }

    // Every cross-feature entry point, invoked where its helper is missing.
    const quiet = await session.evaluate(`(() => {
      const errors = [];
      const tryIt = (label, fn) => { try { fn(); } catch (e) { errors.push(label + ': ' + e.message); } };
      tryIt('speakClaude', () => window.__onMessage({ action: 'speakClaude' }, {}, () => {}));
      tryIt('speakChat', () => window.__onMessage({ action: 'speakChat' }, {}, () => {}));
      tryIt('isClaude', () => window.__onMessage({ action: 'isClaude' }, {}, () => {}));
      tryIt('speakYouTube', () => window.__onMessage({ action: 'speakYouTube' }, {}, () => {}));
      tryIt('stepForward', () => window.__onMessage({ action: 'stepForward' }, {}, () => {}));
      tryIt('updateSettings', () => window.__onMessage(
        { action: 'updateSettings', settings: { autoReadClaude: true, autoReadChatgpt: true } }, {}, () => {}));
      tryIt('storage change', () => window.__onChanged &&
        window.__onChanged({ autoReadClaude: { newValue: true }, autoReadChatgpt: { newValue: true } }, 'sync'));
      tryIt('stop', () => window.__onMessage({ action: 'stop' }, {}, () => {}));
      return errors;
    })()`);

    check(`${page}: the other site's actions fail quietly`, quiet.length === 0, quiet.join('; '));
  } finally {
    session.close();
  }
}

// The lists above are a copy of what the worker builds, so they can drift.
{
  const background = readFileSync(join(EXT, 'background.js'), 'utf8');
  const sites = readFileSync(join(EXT, 'sites.js'), 'utf8');
  check('worker adds the YouTube helper on a video page',
    /isYouTubeWatchUrl\(url\)\)\s*files\.push\('youtube\.js'\)/.test(background));
  check('worker adds a chat helper from the site catalog',
    /files\.push\(site\.file\)/.test(background));
  check('worker keeps content.js last, after its helpers',
    background.indexOf("files.push('content.js')") > background.indexOf("files.push('youtube.js')"));
  check('registered chat scripts use each site\'s own origins',
    /matches:\s*site\.origins/.test(background));
  check('the site catalog names Claude and ChatGPT',
    /id:\s*'claude'/.test(sites) && /id:\s*'chatgpt'/.test(sites));
}

let failed = 0;
for (const r of results) {
  console.log(`  ${r.pass ? 'pass' : 'FAIL'}  ${r.name}${r.pass ? '' : '  -> ' + r.detail}`);
  if (!r.pass) failed++;
}
console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
