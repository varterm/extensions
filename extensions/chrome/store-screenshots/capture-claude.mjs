// Captures the store screenshot for reading Claude replies.
//
// claude.ai needs a login, so this cannot photograph the real thing. It renders
// a neutral stand-in conversation - no Anthropic branding, no borrowed logo -
// and puts the real reader panel on top of it, so what the picture shows of
// Varterm is genuinely Varterm.
//
// Before submitting, replace the output with a real capture from a logged-in
// session if you can. This exists so the shot can be regenerated at all, which
// the previous throwaway scripts could not.
//
// Run with: node store-screenshots/capture-claude.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome } from '../tests/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(HERE, '..');
const OUT = join(HERE, 'shot5-claude.png');

if (!findChrome()) {
  console.error('No Chrome found. Set CHROME to a browser binary.');
  process.exit(1);
}

const REPLY = [
  'A vector database stores text as coordinates rather than as words, which is what lets it answer "find me something like this" instead of "find me exactly this".',
  'Each passage is turned into a list of a few hundred numbers by an embedding model. Passages about similar things end up close together in that space, even when they share no vocabulary at all.',
  'A search then becomes a geometry problem. Your question is embedded the same way, and the database returns the passages sitting nearest to it, ranked by distance.',
  'The practical consequence is that a question phrased nothing like the source text still finds it. Asking about "keeping servers from falling over" can surface a page that only ever says "load balancing".',
];

const PAGE = `
<!doctype html>
<meta charset="utf-8">
<title>Vector databases - Assistant</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; background: #262624; color: #f5f4ef; min-height: 100vh;
    font: 15px/1.65 ui-sans-serif, -apple-system, 'Segoe UI', system-ui, sans-serif;
  }
  .rail {
    position: fixed; inset: 0 auto 0 0; width: 210px; padding: 16px;
    background: #1f1e1d; border-right: 1px solid rgba(255,255,255,.07);
  }
  .rail h1 { font-size: 13px; color: #a3a09a; margin: 0 0 14px; letter-spacing: .04em; text-transform: uppercase; }
  .rail div { font-size: 13px; color: #cfcbc3; padding: 7px 8px; border-radius: 6px; }
  .rail div.on { background: rgba(255,255,255,.06); }
  main { margin-left: 210px; padding: 40px 48px 80px; max-width: 720px; }
  .ask { color: #cfcbc3; background: #33322f; border-radius: 12px; padding: 12px 16px; margin-bottom: 28px; }
  .turn { margin-bottom: 26px; }
  .standard-markdown p { margin: 0 0 14px; }
  .actions { display: flex; gap: 2px; margin-top: 6px; opacity: .75; }
  .actions button {
    background: none; border: none; color: #a3a09a; cursor: pointer;
    padding: 4px 6px; border-radius: 6px; font-size: 13px;
  }
</style>
<div class="rail">
  <h1>Chats</h1>
  <div class="on">Vector databases</div>
  <div>Rollout plan review</div>
  <div>Reading list</div>
</div>
<main>
  <div class="ask">Explain how a vector database actually works.</div>
  <div class="turn" data-is-streaming="false" id="reply">
    <div class="font-claude-response">
      <div class="standard-markdown">
        ${REPLY.map((p) => `<p>${p}</p>`).join('\n        ')}
      </div>
    </div>
    <div class="actions">
      <button aria-label="Copy">Copy</button>
      <button aria-label="Retry">Retry</button>
    </div>
  </div>
</main>`;

const session = await launchChrome({ width: 1280, height: 800 });
try {
  await session.evaluate(`document.write(${JSON.stringify(PAGE)}); document.close(); true`);

  for (const file of ['voices.js', 'panel.js', 'claude.js']) {
    await session.evaluate(readFileSync(join(EXT, file), 'utf8'));
  }
  await session.evaluate(`
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(readFileSync(join(EXT, 'content.css'), 'utf8'))};
    document.head.appendChild(style); true`);

  // The real adapter supplies both the inline button and the text, so the
  // picture cannot drift from what the extension does.
  await session.evaluate(`(() => {
    vartermClaudeAddButtons(() => {});

    const body = document.querySelector('.font-claude-response');
    const lines = vartermClaudeText(body).split('\\n').filter(Boolean)
      .map((text) => ({ text, ts: null, part: 0 }));

    vartermPanelOpen({
      title: 'Vector databases',
      lines,
      partCount: 3,
      voices: VARTERM_VOICES,
      settings: { voiceTier: 'cloud', voice: VARTERM_DEFAULT_VOICE, rate: 1.0 },
      layout: { width: 400, collapsed: false },
      handlers: {},
      kind: '',
    });
    vartermPanelSetPlaying(true);
    vartermPanelSetPart(0, 3);
    vartermPanelSetActive(1, 1);
    vartermPanelSetProgress(0.42, 38, 91);
    vartermPanelSetStatus('Reading in Emma');
    return true;
  })()`);

  await new Promise((r) => setTimeout(r, 400));
  writeFileSync(OUT, await session.screenshot());
  console.log(`wrote ${OUT}`);
} finally {
  session.close();
}
