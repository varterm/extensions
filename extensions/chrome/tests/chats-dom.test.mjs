// Runs chats.js against rebuilt page shapes for ChatGPT, Kimi, and Gemini.
// Same idea as claude-dom.test.mjs: the live sites need a login, so the
// extractors are driven against fixtures that match the documented selectors.
//
// Run with: node tests/chats-dom.test.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome } from './cdp.mjs';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!findChrome()) {
  console.log('skipped: no Chrome found (set CHROME to run these)');
  process.exit(0);
}

const FIXTURE = `
<div id="chatgpt">
  <div data-message-author-role="user"><div class="markdown"><p>hello</p></div></div>
  <div id="gpt-done" data-message-author-role="assistant">
    <div class="markdown prose">
      <p>First ChatGPT paragraph.</p>
      <p>Second ChatGPT paragraph.</p>
      <pre>const secret = "do not read code aloud";</pre>
    </div>
    <div class="actions">
      <button data-testid="copy-turn-action-button" aria-label="Copy">copy</button>
    </div>
  </div>
  <div id="gpt-stream" data-message-author-role="assistant" data-is-streaming="true">
    <div class="markdown prose"><p>Still being written</p></div>
  </div>
</div>
<div id="kimi">
  <div class="segment-assistant" id="kimi-done">
    <div class="markdown"><p>Kimi finished reply.</p></div>
  </div>
</div>
<div id="gemini">
  <div class="model-response" id="gemini-done">
    <div class="model-response-text">
      <p>Thinking about it</p>
      <p>Gemini finished reply.</p>
    </div>
  </div>
</div>`;

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, pass: !!condition, detail });
};

const session = await launchChrome();
try {
  await session.evaluate(`document.title = 'My chat - ChatGPT';
    document.body.innerHTML = ${JSON.stringify(FIXTURE)}; true`);
  await session.evaluate(readFileSync(join(EXT, 'chats.js'), 'utf8'));

  const extracted = await session.evaluate(`(() => {
    const site = (id) => VARTERM_CHAT_ADAPTERS.find((a) => a.id === id);
    const gpt = site('chatgpt');
    const kimi = site('kimi');
    const gemini = site('gemini');
    return {
      gptText: vartermChatText(gpt, document.querySelector('#gpt-done')),
      kimiText: vartermChatText(kimi, document.querySelector('#kimi-done')),
      geminiText: vartermChatText(gemini, document.querySelector('#gemini-done')),
      gptStreaming: vartermChatIsStreaming(gpt, document.querySelector('#gpt-stream')),
      gptDoneStreaming: vartermChatIsStreaming(gpt, document.querySelector('#gpt-done')),
      gptBodies: vartermChatBodies(gpt).length,
    };
  })()`);

  check('ChatGPT reads the prose',
    extracted.gptText.includes('First ChatGPT paragraph.'), extracted.gptText);
  check('ChatGPT keeps paragraphs apart',
    !/First ChatGPT paragraph\.Second/.test(extracted.gptText) &&
      extracted.gptText.includes('Second ChatGPT paragraph.'),
    extracted.gptText);
  check('ChatGPT never reads code aloud',
    !extracted.gptText.includes('do not read code'), extracted.gptText);
  check('ChatGPT sees the streaming flag', extracted.gptStreaming === true);
  check('ChatGPT finished reply is not streaming', extracted.gptDoneStreaming === false);
  check('ChatGPT finds assistant bodies and skips the user',
    extracted.gptBodies === 2, `found ${extracted.gptBodies}`);
  check('Kimi reads its reply', extracted.kimiText.includes('Kimi finished reply.'), extracted.kimiText);
  check('Gemini reads its reply',
    extracted.geminiText.includes('Gemini finished reply.'), extracted.geminiText);
  check('Gemini drops a leaked thinking line',
    !extracted.geminiText.includes('Thinking about it'), extracted.geminiText);

  const watched = await session.evaluate(`(async () => {
    const gpt = VARTERM_CHAT_ADAPTERS.find((a) => a.id === 'chatgpt');
    gpt.isHere = () => true;
    const spoken = [];
    vartermChatWatch(gpt, (text) => spoken.push(text));
    const settle = () => new Promise((r) => setTimeout(r, 60));
    await settle();
    const afterPrime = spoken.length;

    const turn = document.createElement('div');
    turn.setAttribute('data-message-author-role', 'assistant');
    turn.setAttribute('data-is-streaming', 'true');
    turn.id = 'fresh';
    turn.innerHTML = '<div class="markdown prose"><p>A brand new ChatGPT reply.</p></div>';
    document.getElementById('chatgpt').appendChild(turn);
    await settle();
    const whileStreaming = spoken.length;

    turn.setAttribute('data-is-streaming', 'false');
    await settle();
    const afterFinish = spoken.length;

    vartermChatUnwatch();
    const ignored = document.createElement('div');
    ignored.setAttribute('data-message-author-role', 'assistant');
    ignored.innerHTML = '<div class="markdown prose"><p>Should never be spoken.</p></div>';
    document.getElementById('chatgpt').appendChild(ignored);
    await settle();

    return { afterPrime, whileStreaming, afterFinish, total: spoken.length, spoken };
  })()`, true);

  check('does not read the backlog when switched on', watched.afterPrime === 0,
    `spoke ${watched.afterPrime}`);
  check('stays quiet while a reply is still streaming', watched.whileStreaming === 0,
    `spoke ${watched.whileStreaming}`);
  check('reads a reply once it finishes', watched.afterFinish === 1,
    JSON.stringify(watched.spoken));
  check('stops when unwatched', watched.total === 1, JSON.stringify(watched.spoken));

  const buttons = await session.evaluate(`(() => {
    const gpt = VARTERM_CHAT_ADAPTERS.find((a) => a.id === 'chatgpt');
    const clicked = [];
    vartermChatAddButtons(gpt, (text) => clicked.push(text));
    const first = document.querySelectorAll('.varterm-chat-btn').length;
    vartermChatAddButtons(gpt, () => {});
    const afterSecondPass = document.querySelectorAll('.varterm-chat-btn').length;
    const btn = document.querySelector('#gpt-done .varterm-chat-btn');
    if (btn) btn.click();
    return { first, afterSecondPass, clicked };
  })()`);

  check('adds a button to finished ChatGPT replies', buttons.first >= 1, `added ${buttons.first}`);
  check('does not add the button twice',
    buttons.afterSecondPass === buttons.first,
    `${buttons.first} then ${buttons.afterSecondPass}`);
  check('clicking it hands over the reply text',
    buttons.clicked.length === 1 && buttons.clicked[0].includes('First ChatGPT paragraph.'),
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
