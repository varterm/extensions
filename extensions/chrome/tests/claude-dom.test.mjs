// Runs claude.js against a real DOM.
//
// The static checks in wiring.test.mjs cannot tell whether the extractor
// actually reads a reply correctly, and claude.ai needs a login so it cannot be
// visited here. Instead the two page shapes claude.ai is known to serve are
// rebuilt as fixtures and driven in headless Chrome.
//
// No dependencies: Chrome is spoken to over the DevTools protocol using the
// WebSocket built into Node 18+. Skips cleanly when Chrome is absent.
//
// Run with: node tests/claude-dom.test.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome } from './cdp.mjs';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!findChrome()) {
  console.log('skipped: no Chrome found (set CHROME to run these)');
  process.exit(0);
}

// The two shapes claude.ai is known to render, plus a reply still streaming.
const FIXTURE = `
<div id="chat">
  <div data-is-streaming="false" class="turn">
    <div data-testid="user-message">what is this</div>
  </div>

  <div data-is-streaming="false" class="turn" id="modern">
    <div class="font-claude-response">
      <div class="standard-markdown">
        <p>First paragraph.</p>
        <p>Second paragraph.</p>
      </div>
      <div class="standard-markdown">
        <p>Third block.</p>
        <pre>const secret = "do not read code aloud";</pre>
      </div>
      <button aria-label="Retry">retry</button>
    </div>
    <div class="actions">
      <button aria-label="Copy">copy</button>
      <button aria-label="Read Aloud">play</button>
    </div>
  </div>

  <div data-is-streaming="false" class="turn" id="legacy">
    <div class="font-claude-message">
      <p>Thought for 3 seconds</p>
      <p>Legacy shape reply.</p>
    </div>
  </div>

  <div data-is-streaming="true" class="turn" id="streaming">
    <div class="font-claude-response">
      <div class="standard-markdown"><p>Still being written</p></div>
    </div>
  </div>
</div>`;

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, pass: !!condition, detail });
};

const session = await launchChrome();
try {
  await session.evaluate(`document.title = 'My chat - Claude';
    document.body.innerHTML = ${JSON.stringify(FIXTURE)}; true`);
  await session.evaluate(readFileSync(join(EXT, 'claude.js'), 'utf8'));

  const found = await session.evaluate(`(() => ({
    bodies: vartermClaudeBodies().length,
    streamingFlags: vartermClaudeBodies().map(vartermClaudeIsStreaming),
    modern: vartermClaudeText(document.querySelector('#modern .font-claude-response')),
    legacy: vartermClaudeText(document.querySelector('#legacy .font-claude-message')),
    title: vartermClaudeTitle(),
    latest: vartermClaudeLatest()
  }))()`);

  check('finds both reply shapes', found.bodies === 3, `found ${found.bodies}`);
  check(
    'tells a finished reply from a streaming one',
    JSON.stringify(found.streamingFlags) === '[false,false,true]',
    JSON.stringify(found.streamingFlags)
  );

  check('reads the prose', found.modern.includes('First paragraph.'), found.modern);
  check(
    'keeps paragraphs apart rather than gluing them',
    !/First paragraph\.Second/.test(found.modern) && found.modern.includes('Second paragraph.'),
    found.modern
  );
  check('joins separate markdown blocks', found.modern.includes('Third block.'), found.modern);
  check('never reads code aloud', !found.modern.includes('do not read code'), found.modern);
  check('leaves Claude\'s own buttons out', !/retry/i.test(found.modern), found.modern);

  check('falls back when there are no markdown blocks',
    found.legacy.includes('Legacy shape reply.'), found.legacy);
  check('drops a leaked thinking summary',
    !found.legacy.includes('Thought for'), found.legacy);

  check('reads the conversation title', found.title === 'My chat', found.title);
  check('latest reply skips the one still streaming',
    found.latest.ok && found.latest.text.includes('Legacy shape reply.'),
    JSON.stringify(found.latest).slice(0, 80));

  // Watching: the backlog must stay silent, new replies must fire once each.
  const watched = await session.evaluate(`(async () => {
    const spoken = [];
    vartermClaudeWatch((text) => spoken.push(text));
    const settle = () => new Promise((r) => setTimeout(r, 60));
    await settle();
    const afterPrime = spoken.length;

    const add = (id, text) => {
      const turn = document.createElement('div');
      turn.setAttribute('data-is-streaming', 'true');
      turn.id = id;
      turn.innerHTML =
        '<div class="font-claude-response"><div class="standard-markdown"><p>' +
        text + '</p></div></div>';
      document.getElementById('chat').appendChild(turn);
      return turn;
    };

    const turn = add('fresh', 'A brand new reply.');
    await settle();
    const whileStreaming = spoken.length;

    turn.setAttribute('data-is-streaming', 'false');
    await settle();
    const afterFinish = spoken.length;

    // A re-render of the same reply must not speak it twice.
    turn.setAttribute('data-is-streaming', 'true');
    turn.setAttribute('data-is-streaming', 'false');
    await settle();
    const afterRerender = spoken.length;

    vartermClaudeUnwatch();
    const ignored = add('after-unwatch', 'Should never be spoken.');
    ignored.setAttribute('data-is-streaming', 'false');
    await settle();

    return { afterPrime, whileStreaming, afterFinish, afterRerender,
             total: spoken.length, spoken };
  })()`, true);

  check('does not read the backlog when switched on', watched.afterPrime === 0,
    `spoke ${watched.afterPrime}`);
  check('stays quiet while a reply is still streaming', watched.whileStreaming === 0,
    `spoke ${watched.whileStreaming}`);
  check('reads a reply once it finishes', watched.afterFinish === 1,
    JSON.stringify(watched.spoken));
  check('does not repeat itself when the reply re-renders', watched.afterRerender === 1,
    `spoke ${watched.afterRerender}`);
  check('stops when unwatched', watched.total === 1, JSON.stringify(watched.spoken));

  // The inline button.
  const buttons = await session.evaluate(`(() => {
    const clicked = [];
    vartermClaudeAddButtons((text) => clicked.push(text));
    const first = document.querySelectorAll('.varterm-claude-btn').length;
    vartermClaudeAddButtons(() => {});
    const afterSecondPass = document.querySelectorAll('.varterm-claude-btn').length;

    const inActionBar = !!document.querySelector('#modern .actions .varterm-claude-btn');
    const beside = document.querySelector('#modern .actions button[aria-label="Copy"]');
    document.querySelector('#modern .actions .varterm-claude-btn').click();

    return { first, afterSecondPass, inActionBar, hasCopyNeighbour: !!beside, clicked };
  })()`);

  check('adds a button to finished replies', buttons.first >= 2, `added ${buttons.first}`);
  check('does not add the button twice',
    buttons.afterSecondPass === buttons.first,
    `${buttons.first} then ${buttons.afterSecondPass}`);
  check('puts it in Claude\'s own button row', buttons.inActionBar && buttons.hasCopyNeighbour);
  check('clicking it hands over the reply text',
    buttons.clicked.length === 1 && buttons.clicked[0].includes('First paragraph.'),
    JSON.stringify(buttons.clicked).slice(0, 80));
} finally {
  session.close();
}

let failed = 0;
for (const r of results) {
  console.log(`  ${r.pass ? 'pass' : 'FAIL'}  ${r.name}${r.pass ? '' : '  -> ' + r.detail}`);
  if (!r.pass) failed++;
}
console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
