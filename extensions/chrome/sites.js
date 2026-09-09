// Shared catalog of optional AI-chat sites.
//
// Loaded by the service worker and the popup so permission origins, storage
// keys, and injected helpers cannot drift apart. Not injected into pages.

var VARTERM_CHAT_SITES = [
  {
    id: 'claude',
    name: 'Claude',
    file: 'claude.js',
    scriptId: 'varterm-claude',
    storageKey: 'autoReadClaude',
    origins: ['https://claude.ai/*'],
    matchUrl: function (url) {
      return /^https:\/\/claude\.ai\//.test(url || '');
    },
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    file: 'chats.js',
    scriptId: 'varterm-chatgpt',
    storageKey: 'autoReadChatgpt',
    origins: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    matchUrl: function (url) {
      return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url || '');
    },
  },
  {
    id: 'kimi',
    name: 'Kimi',
    file: 'chats.js',
    scriptId: 'varterm-kimi',
    storageKey: 'autoReadKimi',
    origins: [
      'https://www.kimi.com/*',
      'https://kimi.com/*',
      'https://kimi.moonshot.cn/*',
    ],
    matchUrl: function (url) {
      return /^https:\/\/((www\.)?kimi\.com|kimi\.moonshot\.cn)\//.test(url || '');
    },
  },
  {
    id: 'gemini',
    name: 'Gemini',
    file: 'chats.js',
    scriptId: 'varterm-gemini',
    storageKey: 'autoReadGemini',
    origins: ['https://gemini.google.com/*'],
    matchUrl: function (url) {
      return /^https:\/\/gemini\.google\.com\//.test(url || '');
    },
  },
  {
    id: 'grok',
    name: 'Grok',
    file: 'chats.js',
    scriptId: 'varterm-grok',
    storageKey: 'autoReadGrok',
    origins: ['https://grok.com/*'],
    matchUrl: function (url) {
      return /^https:\/\/grok\.com\//.test(url || '');
    },
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    file: 'chats.js',
    scriptId: 'varterm-perplexity',
    storageKey: 'autoReadPerplexity',
    origins: ['https://www.perplexity.ai/*', 'https://perplexity.ai/*'],
    matchUrl: function (url) {
      return /^https:\/\/(www\.)?perplexity\.ai\//.test(url || '');
    },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    file: 'chats.js',
    scriptId: 'varterm-deepseek',
    storageKey: 'autoReadDeepSeek',
    origins: ['https://chat.deepseek.com/*'],
    matchUrl: function (url) {
      return /^https:\/\/chat\.deepseek\.com\//.test(url || '');
    },
  },
];

function vartermSiteForUrl(url) {
  for (var i = 0; i < VARTERM_CHAT_SITES.length; i++) {
    if (VARTERM_CHAT_SITES[i].matchUrl(url)) return VARTERM_CHAT_SITES[i];
  }
  return null;
}

function vartermChatOrigins() {
  var out = [];
  for (var i = 0; i < VARTERM_CHAT_SITES.length; i++) {
    out = out.concat(VARTERM_CHAT_SITES[i].origins);
  }
  return out;
}

function vartermDefaultSettings() {
  var defaults = {
    voiceTier: 'cloud',
    voice: 'en-US-AriaNeural',
    rate: 1.0,
    stripMarkdown: true,
  };
  for (var i = 0; i < VARTERM_CHAT_SITES.length; i++) {
    defaults[VARTERM_CHAT_SITES[i].storageKey] = false;
  }
  return defaults;
}
