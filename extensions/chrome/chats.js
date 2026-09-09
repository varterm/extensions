// Varterm TTS Chrome Extension - AI chat reading
//
// Same job as claude.js, for the other chats: read a finished assistant reply
// in a Varterm voice, optionally as it lands, and put a listen button on each
// one. Selectors are best-effort — these sites redesign — so each adapter
// tries a short priority list and keeps the first that matches.
//
// Re-injected on every invocation, so no top-level const/let, and the state
// below is written to survive being declared a second time.

var VARTERM_CHAT_DROP = [
  'pre',
  'button',
  '[role="button"]',
  '[aria-hidden="true"]',
  'nav',
  'svg',
  'code',
];
var VARTERM_CHAT_BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, tr, br, div';

var VARTERM_CHAT_ADAPTERS = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    storageKey: 'autoReadChatgpt',
    titleSuffix: /\s*[-|]\s*ChatGPT\s*$/i,
    defaultTitle: 'ChatGPT',
    isHere: function () {
      return /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/.test(location.hostname);
    },
    bodies:
      '[data-message-author-role="assistant"], [data-role="assistant"], [data-message-author="assistant"]',
    prose: '.markdown.prose, .markdown, .prose',
    stop:
      'button[data-testid="stop-button"], button[aria-label*="Stop streaming" i], button[aria-label*="Stop generating" i]',
    copy: 'button[data-testid="copy-turn-action-button"], button[aria-label*="Copy" i]',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    storageKey: 'autoReadKimi',
    titleSuffix: /\s*[-|]\s*Kimi\s*$/i,
    defaultTitle: 'Kimi',
    isHere: function () {
      return /(^|\.)kimi\.com$|(^|\.)kimi\.moonshot\.cn$/.test(location.hostname);
    },
    bodies:
      '[class*="segment-assistant"], [data-role="assistant"], .chat-content-item-assistant, [class*="assistant-message"]',
    prose: '.markdown, .prose, [class*="markdown"]',
    stop: 'button[aria-label*="Stop" i], button[aria-label*="stop" i]',
    copy: 'button[aria-label*="Copy" i], button[aria-label*="copy" i]',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    storageKey: 'autoReadGemini',
    titleSuffix: /\s*[-|]\s*Gemini\s*$/i,
    defaultTitle: 'Gemini',
    isHere: function () {
      return /(^|\.)gemini\.google\.com$/.test(location.hostname);
    },
    bodies:
      'model-response, .model-response, [data-test-id="model-response"], [data-message-author="model"]',
    prose: '.model-response-text, .message-content, .markdown, .prose',
    stop:
      'button[aria-label*="Stop generating" i], button[aria-label*="Stop response" i]',
    copy: 'button[aria-label*="Copy" i]',
  },
  {
    id: 'grok',
    name: 'Grok',
    storageKey: 'autoReadGrok',
    titleSuffix: /\s*[-|]\s*Grok\s*$/i,
    defaultTitle: 'Grok',
    isHere: function () {
      return /(^|\.)grok\.com$/.test(location.hostname);
    },
    bodies:
      '[data-testid="assistant-message"], [class*="response-content"], [data-message-author-role="assistant"]',
    prose: '.prose, .markdown, [class*="markdown"]',
    stop: 'button[aria-label*="Stop" i]',
    copy: 'button[aria-label*="Copy" i]',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    storageKey: 'autoReadPerplexity',
    titleSuffix: /\s*[-|]\s*Perplexity\s*$/i,
    defaultTitle: 'Perplexity',
    isHere: function () {
      return /(^|\.)perplexity\.ai$/.test(location.hostname);
    },
    bodies: '[data-testid="answer"], [class*="answer-content"]',
    prose: '.prose, .markdown',
    stop: 'button[aria-label*="Stop" i]',
    copy: 'button[aria-label*="Copy" i]',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    storageKey: 'autoReadDeepSeek',
    titleSuffix: /\s*[-|]\s*DeepSeek\s*$/i,
    defaultTitle: 'DeepSeek',
    isHere: function () {
      return /(^|\.)chat\.deepseek\.com$/.test(location.hostname);
    },
    bodies: '[data-role="assistant"], .ds-message--assistant, [class*="ds-message"]',
    prose: '.ds-markdown, .markdown, .prose',
    stop: 'button[aria-label*="Stop" i]',
    copy: 'button[aria-label*="Copy" i]',
  },
];

var VARTERM_CHAT_SEEN = VARTERM_CHAT_SEEN || new WeakSet();
var VARTERM_CHAT_LAST = VARTERM_CHAT_LAST || '';
var VARTERM_CHAT_OBSERVER = VARTERM_CHAT_OBSERVER || null;

function vartermChatQueryFirst(selectorList) {
  var parts = String(selectorList || '').split(',');
  for (var i = 0; i < parts.length; i++) {
    var sel = parts[i].trim();
    if (!sel) continue;
    try {
      var found = document.querySelectorAll(sel);
      if (found.length) return Array.from(found);
    } catch (e) {
      // A selector the current page's CSS parser rejects is skipped.
    }
  }
  return [];
}

function vartermChatActive() {
  for (var i = 0; i < VARTERM_CHAT_ADAPTERS.length; i++) {
    if (VARTERM_CHAT_ADAPTERS[i].isHere()) return VARTERM_CHAT_ADAPTERS[i];
  }
  return null;
}

function vartermChatBodies(site) {
  site = site || vartermChatActive();
  if (!site) return [];
  return vartermChatQueryFirst(site.bodies);
}

function vartermChatIsStreaming(site, body) {
  if (body && body.closest && body.closest('[data-is-streaming="true"]')) return true;
  if (!site || !site.stop) return false;
  try {
    return !!document.querySelector(site.stop);
  } catch (e) {
    return false;
  }
}

function vartermChatText(site, body) {
  if (!body) return '';
  var blocks = site.prose ? body.querySelectorAll(site.prose) : [];
  var sources = blocks.length ? Array.from(blocks) : [body];
  var parts = [];

  for (var s = 0; s < sources.length; s++) {
    var copy = sources[s].cloneNode(true);
    for (var d = 0; d < VARTERM_CHAT_DROP.length; d++) {
      var junk = copy.querySelectorAll(VARTERM_CHAT_DROP[d]);
      for (var j = 0; j < junk.length; j++) junk[j].remove();
    }
    var marks = copy.querySelectorAll(VARTERM_CHAT_BLOCKS);
    for (var b = 0; b < marks.length; b++) {
      marks[b].after(document.createTextNode('\n'));
    }
    var text = (copy.textContent || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text) parts.push(text);
  }

  var joined = parts.join('\n\n');
  var paragraphs = joined.split(/\n{2,}/);
  while (
    paragraphs.length > 1 &&
    /^(Thought|Thinking|View|Reasoning|Thoughts)\b/i.test(paragraphs[0])
  ) {
    paragraphs.shift();
  }
  return paragraphs.join('\n\n').trim();
}

function vartermChatTitle(site) {
  site = site || vartermChatActive();
  if (!site) return document.title;
  return document.title.replace(site.titleSuffix, '').trim() || site.defaultTitle;
}

function vartermChatLatest() {
  var site = vartermChatActive();
  if (!site) {
    return { ok: false, reason: 'not-chat', message: 'No chat reply on this page.' };
  }
  var bodies = vartermChatBodies(site);
  for (var i = bodies.length - 1; i >= 0; i--) {
    if (vartermChatIsStreaming(site, bodies[i])) continue;
    var text = vartermChatText(site, bodies[i]);
    if (text) return { ok: true, text: text, title: vartermChatTitle(site) };
  }
  return {
    ok: false,
    reason: 'empty',
    message: bodies.length
      ? 'That reply is still being written.'
      : 'No ' + site.name + ' reply on this page yet.',
  };
}

function vartermChatDeliver(site, body, onMessage) {
  if (!body || VARTERM_CHAT_SEEN.has(body)) return;
  if (vartermChatIsStreaming(site, body)) return;

  var text = vartermChatText(site, body);
  if (!text || text.length < 8) return;

  if (text === VARTERM_CHAT_LAST) {
    VARTERM_CHAT_SEEN.add(body);
    return;
  }

  VARTERM_CHAT_SEEN.add(body);
  VARTERM_CHAT_LAST = text;
  onMessage(text, vartermChatTitle(site));
}

function vartermChatPrime(site) {
  var bodies = vartermChatBodies(site);
  for (var i = 0; i < bodies.length; i++) {
    if (vartermChatIsStreaming(site, bodies[i])) continue;
    VARTERM_CHAT_SEEN.add(bodies[i]);
    VARTERM_CHAT_LAST = vartermChatText(site, bodies[i]) || VARTERM_CHAT_LAST;
  }
}

function vartermChatWatch(site, onMessage) {
  site = site || vartermChatActive();
  if (!site) return false;
  vartermChatUnwatch();
  vartermChatPrime(site);

  VARTERM_CHAT_OBSERVER = new MutationObserver(function () {
    var bodies = vartermChatBodies(site);
    for (var i = 0; i < bodies.length; i++) {
      vartermChatDeliver(site, bodies[i], onMessage);
    }
  });

  VARTERM_CHAT_OBSERVER.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-is-streaming'],
  });

  return true;
}

function vartermChatUnwatch() {
  if (VARTERM_CHAT_OBSERVER) {
    VARTERM_CHAT_OBSERVER.disconnect();
    VARTERM_CHAT_OBSERVER = null;
  }
}

function vartermChatActionBar(site, body) {
  var host = body.parentElement || body;
  if (site.copy) {
    try {
      var copy = host.querySelector(site.copy) || document.querySelector(site.copy);
      if (copy && copy.parentElement) return copy.parentElement;
    } catch (e) {
      // ignore a selector the page rejects
    }
  }
  return null;
}

function vartermChatAddButtons(site, onRead) {
  site = site || vartermChatActive();
  if (!site) return;
  var bodies = vartermChatBodies(site);
  for (var i = 0; i < bodies.length; i++) {
    var body = bodies[i];
    if (vartermChatIsStreaming(site, body)) continue;
    var bar = vartermChatActionBar(site, body);
    var host = bar || body;
    if (host.querySelector('.varterm-chat-btn')) continue;

    var button = document.createElement('button');
    button.className = 'varterm-chat-btn';
    button.type = 'button';
    button.title = 'Read with Varterm';
    button.setAttribute('aria-label', 'Read with Varterm');
    button.textContent = '\uD83D\uDD0A';
    button.addEventListener('click', function (captured) {
      return function (e) {
        e.preventDefault();
        e.stopPropagation();
        var text = vartermChatText(site, captured);
        if (text) onRead(text, vartermChatTitle(site));
      };
    }(body));

    host.appendChild(button);
  }
}
