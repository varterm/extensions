// Regenerates the 1280x800 Chrome Web Store screenshots from the current UI.
//
// Run with: node store-screenshots/capture-store.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome, launchChrome } from '../tests/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(HERE, '..');

if (!findChrome()) {
  console.error('No Chrome found. Set CHROME to a browser binary.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureHtml(session, file, outName) {
  await session.navigate(pathToFileURL(join(HERE, file)).href);
  await sleep(700);
  writeFileSync(join(HERE, outName), await session.screenshot());
  console.log(`wrote ${outName}`);
}

const TRANSCRIPT_LINES = [
  { ts: '0:12', sec: 12, text: 'Today we are going to talk about how posture changes the way you feel.' },
  { ts: '0:18', sec: 18, text: 'Not in a vague way. In a measurable way, over the next few minutes.' },
  { ts: '0:25', sec: 25, text: 'Hold your posture for two minutes, but before you do that, notice how you are sitting now.' },
  { ts: '0:33', sec: 33, text: 'And what you are doing with your body — how many of you are making yourselves smaller?' },
  { ts: '0:39', sec: 39, text: 'Maybe you are hunching, crossing your legs, wrapping your ankles.' },
  { ts: '0:46', sec: 46, text: 'That closed shape is a habit. The open one can be practiced.' },
  { ts: '0:52', sec: 52, text: 'We will come back to this after a short example from the lab.' },
];

const VIDEO_PAGE = `
<!doctype html>
<meta charset="utf-8">
<title>How posture changes how you feel</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0f1115; color: #e8eaed; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
  .stage { padding: 28px 32px; max-width: 820px; }
  .player {
    width: 760px; height: 428px; border-radius: 12px;
    background: radial-gradient(circle at 30% 20%, #2a3344, #11151c 70%);
    display: grid; place-items: center; color: #9aa3b2; font-size: 15px;
    border: 1px solid rgba(255,255,255,.08);
  }
  h1 { font-size: 22px; margin: 18px 0 6px; }
  .meta { color: #8b939e; font-size: 13px; }
</style>
<div class="stage">
  <div class="player">Lecture · 18:42</div>
  <h1>How posture changes how you feel</h1>
  <div class="meta">A recorded talk · captions available</div>
</div>`;

async function captureTranscript(session, { search, outName }) {
  await session.evaluate(`document.write(${JSON.stringify(VIDEO_PAGE)}); document.close(); true`);
  for (const file of ['voices.js', 'panel.js']) {
    await session.evaluate(readFileSync(join(EXT, file), 'utf8'));
  }
  const lines = TRANSCRIPT_LINES.map((line, i) => ({ ...line, part: Math.floor(i / 3) }));
  await session.evaluate(`(() => {
    const lines = ${JSON.stringify(lines)};
    vartermPanelOpen({
      title: 'How posture changes how you feel',
      lines,
      partCount: 3,
      kind: 'transcript',
      voices: VARTERM_VOICES,
      settings: { voiceTier: 'cloud', voice: VARTERM_DEFAULT_VOICE, rate: 1.0 },
      layout: { width: 400, collapsed: false },
      handlers: { onSeekMedia: () => {} },
    });
    vartermPanelSetPlaying(true);
    vartermPanelSetPart(1, 3);
    vartermPanelSetActive(3, 4);
    vartermPanelSetProgress(0.38, 41, 108);
    vartermPanelSetStatus('Speaking part 2 of 3');
    ${search ? `vartermPanelSearch(${JSON.stringify(search)});` : ''}
    return true;
  })()`);
  await sleep(500);
  writeFileSync(join(HERE, outName), await session.screenshot());
  console.log(`wrote ${outName}`);
}

const session = await launchChrome({ width: 1280, height: 800 });
try {
  await captureHtml(session, 'shot1.html', 'shot1-select.png');
  await captureHtml(session, 'shot2.html', 'shot2-markdown.png');
  await captureHtml(session, 'shot3.html', 'shot3-workflow.png');
  await captureHtml(session, 'shot4.html', 'shot4-popup.png');
  await captureTranscript(session, { outName: 'shot1-video-transcript.png' });
  await captureTranscript(session, { search: 'posture', outName: 'shot2-search.png' });
} finally {
  session.close();
}

{
  const { spawn } = await import('node:child_process');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HERE, 'capture-claude.mjs')], { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('capture-claude failed'))));
  });
}
