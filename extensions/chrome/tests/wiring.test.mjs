// Checks that the pieces of the extension still refer to each other correctly:
// message actions, context menu ids, popup element ids, injected files.
// Run with: node tests/wiring.test.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(EXT, f), 'utf8');

const background = read('background.js');
const content = read('content.js');
const popupJs = read('popup.js');
const popupHtml = read('popup.html');
const youtube = read('youtube.js');
const pkg = read('package.sh');
const manifest = JSON.parse(read('manifest.json'));

let fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '  ' + detail}`);
  if (!cond) fail++;
};

console.log('message actions reach a handler in content.js');
const handled = [...content.matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1]);
for (const action of ['speak', 'speakSelection', 'speakPage', 'speakYouTube', 'speakChat', 'stop', 'pause', 'stepBack', 'stepForward', 'isYouTubeVideo']) {
  check(`content.js handles "${action}"`, handled.includes(action));
}

console.log('\nactions the worker and popup send are all handled');
const sentActions = new Set([
  ...[...background.matchAll(/action:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]),
  ...[...popupJs.matchAll(/tabAction:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]),
]);
const workerOwn = ['getAudio', 'getSettings', 'saveSettings', 'performTabAction', 'updateSettings'];
for (const a of sentActions) {
  if (workerOwn.includes(a)) continue;
  check(`"${a}" is handled by content.js`, handled.includes(a));
}

console.log('\ncontext menus: every created id has a click handler');
const created = [...background.matchAll(/id:\s*'(varterm-[a-z-]+)'/g)].map((m) => m[1]);
const routed = [...background.matchAll(/menuItemId === '(varterm-[a-z-]+)'/g)].map((m) => m[1]);
check('at least one menu exists', created.length >= 3, `found ${created.length}`);
for (const id of created) check(`"${id}" is routed`, routed.includes(id));
for (const id of routed) check(`"${id}" is created`, created.includes(id));

console.log('\npopup: ids used by script exist in markup');
for (const id of [...popupJs.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1])) {
  check(`#${id} present in popup.html`, popupHtml.includes(`id="${id}"`));
}

console.log('\nfiles injected by the worker exist and ship');
const injected = new Set(
  [...background.matchAll(/files:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
);
// the injected list is built from a ternary, so name those files explicitly
injected.add('youtube.js');
injected.add('panel.js');
injected.add('voices.js');
injected.add('claude.js');
injected.add('chats.js');
injected.add('sites.js');
for (const f of injected) {
  check(`${f} exists`, existsSync(join(EXT, f)));
  check(`${f} is copied by package.sh`, pkg.includes(`cp ${f} dist/`));
}

console.log('\nmanifest and permissions');
check('manifest v3', manifest.manifest_version === 3);
check('activeTab present (covers YouTube without a host permission)', manifest.permissions.includes('activeTab'));
check('scripting present', manifest.permissions.includes('scripting'));
check('contextMenus present', manifest.permissions.includes('contextMenus'));
check('no new host permission added for youtube',
  !JSON.stringify(manifest.host_permissions || []).includes('youtube'));
check('install-time host is only the synthesis API path',
  JSON.stringify(manifest.host_permissions) === JSON.stringify(['https://www.varterm.com/api/*']));
check('public description does not catalog third-party chat names',
  !/ChatGPT|Claude|Kimi|Gemini|Grok|Perplexity|DeepSeek/.test(manifest.description));
check('read shortcut is not Chrome hard-reload',
  manifest.commands['read-selection']?.suggested_key?.default === 'Alt+Shift+R' &&
  !JSON.stringify(manifest.commands).includes('Ctrl+Shift+R'));
check('content script handles Alt+Shift+R itself',
  content.includes("e.code !== 'KeyR'") && content.includes('speakSelection()'));

console.log('\nyoutube.js is safe to inject repeatedly');
const topLevelLexical = [...youtube.matchAll(/^(?:const|let)\s+\w+/gm)].map((m) => m[0]);
check('no top-level const/let that would throw on re-injection',
  topLevelLexical.length === 0, topLevelLexical.join(', '));
check('exposes the entry point', /function vartermGetYouTubeTranscript/.test(youtube));
check('exposes the page test', /function vartermIsYouTubeWatch/.test(youtube));

console.log('\ncontent.js YouTube path');
check('calls the extractor', content.includes('vartermGetYouTubeTranscript()'));
check('guards against the helper missing', content.includes("typeof vartermGetYouTubeTranscript !== 'function'"));
check('reads caption rows as panel lines', content.includes('startReading(result.lines'));
check('stopping bumps the token', /function stopAudioOnly\(\)\s*\{\s*playToken\+\+/.test(content));
check('stop tears down the whole run', /function stopSpeaking\(\)\s*\{\s*stopAudioOnly\(\)/.test(content));
check('part loop checks the token', content.includes('if (token !== playToken) return;'));
check('cached parts are capped', content.includes('PART_CACHE_LIMIT'));

console.log('\nreader panel');
const panel = read('panel.js');
const panelLexical = [...panel.matchAll(/^(?:const|let)\s+\w+/gm)].map((m) => m[0]);
check('no top-level const/let that would throw on re-injection',
  panelLexical.length === 0, panelLexical.join(', '));
check('renders inside a shadow root so page styles cannot reach it',
  panel.includes("attachShadow({ mode: 'open' })"));
check('builds highlights as text nodes rather than injected markup',
  panel.includes('document.createTextNode') && !/innerHTML\s*=\s*[^;]*line\.text/.test(panel));
for (const fn of [
  'vartermPanelOpen',
  'vartermPanelClose',
  'vartermPanelSetActive',
  'vartermPanelSetProgress',
  'vartermPanelSetPlaying',
  'vartermPanelSetStatus',
  'vartermPanelSetPart',
  'vartermPanelSearch',
]) {
  check(`defines ${fn}`, new RegExp(`function ${fn}\\b`).test(panel));
  check(`${fn} is guarded or called by content.js`,
    content.includes(fn) || fn === 'vartermPanelSearch');
}

console.log('\npanel controls are wired to the player');
for (const handler of ['onJump', 'onToggle', 'onStep', 'onSeek', 'onClose', 'onSettings', 'onLayout', 'onSeekMedia']) {
  check(`${handler} handled in panel.js`, panel.includes(`handlers.${handler}`));
  check(`${handler} supplied by content.js`, content.includes(`${handler}:`));
}
check('seeking moves the audio', /function seekWithinPart[^]*?audio\.currentTime\s*=/.test(content));
check('progress is fed from timeupdate', content.includes('element.ontimeupdate'));
check('clicking a line lands inside its part, not at the start of it',
  content.includes('offsetOfLineInPart(lineIndex)') && content.includes('startFraction * element.duration'));

console.log('\nsearch covers the whole text, and parts are visible');
check('search walks every rendered line', panel.includes('vartermPanelRows().forEach'));
check('every line is rendered, not just the current part',
  panel.includes('vartermPanelState.lines.forEach'));
check('content.js hands the panel all lines', content.includes('lines: reader.lines'));
check('content.js tags each line with its part', content.includes('part: partIndexOf('));
check('panel draws a divider per part', panel.includes("class: 'divider'"));
check('hit count reports how many parts matched', panel.includes('partsWithHits'));
check('placeholder names the search scope', panel.includes('Search all ${vartermPanelState.partCount} parts'));

console.log('\ntimestamps move the video');
check('captions carry numeric seconds', youtube.includes('sec: vartermParseTimestamp(row.ts)'));
check('timestamp parser handles h:mm:ss', /parts\.length === 3/.test(youtube));
check('timestamp is its own control, not the row click', panel.includes('e.stopPropagation()'));
check('only clickable when a seconds value exists',
  panel.includes("typeof line.sec === 'number'"));
check('content.js moves the player', /function seekPageMedia[^]*?video\.currentTime = seconds/.test(content));
check('play state is left alone', !/function seekPageMedia[^]*?video\.play\(\)/.test(content));
check('refuses to seek during an ad', content.includes("'.ad-showing"));

console.log('\nlayout and settings');
check('collapse toggles a class rather than removing the panel', panel.includes("classList.toggle('mini'"));
check('resize is bounded', panel.includes('VARTERM_PANEL_MIN_WIDTH') && panel.includes('VARTERM_PANEL_MAX_WIDTH'));
check('layout is persisted', content.includes('chrome.storage.sync.set({ panelLayout'));
check('changing voice drops stale audio', /function applySettingsFromPanel[^]*?reader\.cache\.clear\(\)/.test(content));
check('scrollbar is styled thin', panel.includes('scrollbar-width: thin'));

console.log('\nvoice catalog is shared');
const voices = read('voices.js');
const voiceLexical = [...voices.matchAll(/^(?:const|let)\s+\w+/gm)].map((m) => m[0]);
check('no top-level const/let that would throw on re-injection',
  voiceLexical.length === 0, voiceLexical.join(', '));
check('popup loads it before its own script',
  popupHtml.indexOf('voices.js') > -1 &&
  popupHtml.indexOf('voices.js') < popupHtml.indexOf('popup.js'));
check('popup builds options from it rather than hardcoding',
  popupJs.includes('VARTERM_VOICES') && !popupHtml.includes('AriaNeural'));
check('panel builds options from it', panel.includes('vartermVoiceLabel'));
check('retired voice ids are mapped', voices.includes('VARTERM_VOICE_ALIASES'));

console.log('\nclaude.ai adapter');
const claude = read('claude.js');
const claudeLexical = [...claude.matchAll(/^(?:const|let)\s+\w+/gm)].map((m) => m[0]);
check('no top-level const/let that would throw on re-injection',
  claudeLexical.length === 0, claudeLexical.join(', '));
check('state survives re-injection', claude.includes('VARTERM_CLAUDE_SEEN || new WeakSet()'));
check('keeps a fallback for each reply shape',
  claude.includes('.font-claude-response') && claude.includes('.font-claude-message'));
check('uses the streaming flag as the completion signal',
  claude.includes('data-is-streaming'));
check('has a fallback when the flag is missing',
  claude.includes('stop response') || claude.includes('stop generating'));
check('prefers the prose blocks over the whole reply',
  claude.includes('.standard-markdown'));
check('never speaks code', /VARTERM_CLAUDE_DROP[^]*'pre'/.test(claude));
check('reads without mutating the page', claude.includes('cloneNode(true)'));
check('marks block boundaries before flattening to text',
  claude.includes('VARTERM_CLAUDE_BLOCKS'));
for (const fn of ['vartermIsClaude', 'vartermClaudeLatest', 'vartermClaudeWatch',
  'vartermClaudeUnwatch', 'vartermClaudeAddButtons']) {
  check(`defines ${fn}`, new RegExp(`function ${fn}\\b`).test(claude));
  check(`${fn} used by content.js`, content.includes(fn));
}
check('content.js guards against the helper missing',
  content.includes("typeof vartermIsClaude !== 'function'"));
check('backlog is not read on enable', claude.includes('vartermClaudePrime'));

console.log('\nother AI chat adapters');
const chats = read('chats.js');
const chatsLexical = [...chats.matchAll(/^(?:const|let)\s+\w+/gm)].map((m) => m[0]);
check('no top-level const/let that would throw on re-injection',
  chatsLexical.length === 0, chatsLexical.join(', '));
check('state survives re-injection', chats.includes('VARTERM_CHAT_SEEN || new WeakSet()'));
check('covers ChatGPT and Kimi',
  chats.includes("id: 'chatgpt'") && chats.includes("id: 'kimi'"));
check('never speaks code', chats.includes("'pre'") && chats.includes('cloneNode(true)'));
check('backlog is not read on enable', chats.includes('vartermChatPrime'));
for (const fn of ['vartermChatActive', 'vartermChatLatest', 'vartermChatWatch',
  'vartermChatUnwatch', 'vartermChatAddButtons']) {
  check(`defines ${fn}`, new RegExp(`function ${fn}\\b`).test(chats));
  check(`${fn} used by content.js`, content.includes(fn));
}
check('content.js guards against the helper missing',
  content.includes("typeof vartermChatActive !== 'function'"));

console.log('\ntranscript search');
check('YouTube transcripts force the reader panel open',
  /startReading\(result\.lines,\s*\{[^}]*panel:\s*true/.test(content));
check('transcripts are tagged so the panel can name the search box',
  content.includes("kind: 'transcript'") && panel.includes('Search this transcript'));
check('search still walks every line', panel.includes('vartermPanelSearch'));
check('popup explains transcript search on a video page',
  popupHtml.includes('id="youtubeHint"') && popupHtml.includes('searchable transcript'));

console.log('\nclaude.ai permission is optional, not install-time');
check('declared optional', (manifest.optional_host_permissions || []).includes('https://claude.ai/*'));
check('not requested at install',
  !JSON.stringify(manifest.host_permissions).includes('claude') &&
  !JSON.stringify(manifest.host_permissions).includes('chatgpt'));
check('popup asks for it from a user gesture',
  popupJs.includes('chrome.permissions.request'));
check('worker registers the script only once granted',
    background.includes('registerContentScripts') && background.includes('hasSitePermission'));
  check('worker follows a revoke', background.includes('permissions.onRemoved'));
  check('turning it off unregisters', background.includes('unregisterContentScripts'));
  check('popup asks from a shared site catalog',
    popupJs.includes('VARTERM_CHAT_SITES') && popupHtml.includes('sites.js'));
  check('worker loads the site catalog', background.includes("importScripts('sites.js')"));

  const sitesSrc = read('sites.js');
  const siteOrigins = [...sitesSrc.matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]);
  const optional = manifest.optional_host_permissions || [];
  check('at least Claude and ChatGPT are optional',
    optional.includes('https://claude.ai/*') && optional.includes('https://chatgpt.com/*'));
  for (const origin of siteOrigins) {
    check(`optional permission lists ${origin}`, optional.includes(origin));
    check(`${origin} is not an install-time host`,
      !(manifest.host_permissions || []).includes(origin));
  }

console.log('\npopup gets out of the way');
check('actions close the popup', popupJs.includes('window.close()'));
check('closing happens only after success', /if \(!response\?\.success\)[^]*?return;[^]*?window\.close\(\)/.test(popupJs));

console.log(fail ? `\n${fail} failing` : '\nall passing');
process.exit(fail ? 1 : 0);
