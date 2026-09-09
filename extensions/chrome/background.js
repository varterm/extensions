// Varterm TTS Chrome Extension - Background Service Worker

importScripts('sites.js');

const API_ENDPOINT = 'https://www.varterm.com';
const RESTRICTED_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'devtools://',
  'view-source:',
  'https://chromewebstore.google.com/'
];

function isRestrictedUrl(url = '') {
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function isYouTubeWatchUrl(url = '') {
  return /^https:\/\/(www\.|m\.)?youtube\.com\/watch\?/.test(url);
}

function ensureContentScript(tabId, callback, url = '') {
  // Site helpers ride along only where they apply. The reader panel goes
  // everywhere text can be read.
  const files = ['voices.js', 'panel.js'];
  if (isYouTubeWatchUrl(url)) files.push('youtube.js');
  const site = vartermSiteForUrl(url);
  if (site && !files.includes(site.file)) files.push(site.file);
  files.push('content.js');

  chrome.scripting.insertCSS(
    {
      target: { tabId },
      files: ['content.css']
    },
    () => {
      if (chrome.runtime.lastError) {
        callback(false);
        return;
      }
      chrome.scripting.executeScript(
        {
          target: { tabId },
          files
        },
        () => {
          if (chrome.runtime.lastError) {
            callback(false);
            return;
          }
          callback(true);
        }
      );
    }
  );
}

function sendToTab(tabId, message, retried = false, tabUrl = '') {
  if (!tabId) return;
  if (tabUrl && isRestrictedUrl(tabUrl)) return;

  chrome.tabs.sendMessage(tabId, message, () => {
    if (chrome.runtime.lastError) {
      const err = chrome.runtime.lastError.message || '';
      const missingReceiver = err.includes('Receiving end does not exist');

      // Self-heal on regular pages by injecting content script once and retrying.
      if (missingReceiver && !retried) {
        const tryInjectAndRetry = (resolvedUrl = '') => {
          if (isRestrictedUrl(resolvedUrl)) return;
          ensureContentScript(tabId, (ok) => {
            if (ok) {
              sendToTab(tabId, message, true, resolvedUrl);
            }
          }, resolvedUrl);
        };

        if (tabUrl) {
          tryInjectAndRetry(tabUrl);
        } else {
          chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) return;
            tryInjectAndRetry(tab?.url || '');
          });
        }
        return;
      }

      // Only log actionable non-restricted errors.
      if (!missingReceiver) {
        chrome.tabs.get(tabId, (tab) => {
          if (!chrome.runtime.lastError && !isRestrictedUrl(tab?.url || '')) {
            console.warn('Varterm tab message failed:', err);
          }
        });
      }
    }
  });
}

function performTabAction(tabAction, sendResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) {
      sendResponse({ success: false, error: 'No active tab' });
      return;
    }

    if (isRestrictedUrl(tab.url || '')) {
      sendResponse({ success: false, error: 'Cannot access this page' });
      return;
    }

    ensureContentScript(tab.id, (ok) => {
      if (!ok) {
        sendResponse({ success: false, error: 'Cannot access this page' });
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: tabAction }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: 'Cannot access this page' });
          return;
        }
        sendResponse(response?.success ? response : { success: true });
      });
    }, tab.url || '');
  });
}

function hasSitePermission(site) {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: site.origins }, (granted) => {
      resolve(!chrome.runtime.lastError && granted);
    });
  });
}

async function registerSiteScript(site) {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [site.scriptId] })
    .catch(() => []);
  if (registered.length) return;

  await chrome.scripting.registerContentScripts([
    {
      id: site.scriptId,
      matches: site.origins,
      js: ['voices.js', 'panel.js', site.file, 'content.js'],
      css: ['content.css'],
      runAt: 'document_idle',
    },
  ]).catch((error) => console.warn('Varterm could not watch ' + site.name + ':', error.message));
}

async function unregisterSiteScript(site) {
  await chrome.scripting.unregisterContentScripts({ ids: [site.scriptId] }).catch(() => {});
}

// Keep each registration in step with its permission, which the user can
// revoke from Chrome's own settings without telling the extension.
async function syncChatScripts() {
  for (const site of VARTERM_CHAT_SITES) {
    if (await hasSitePermission(site)) {
      await registerSiteScript(site);
    } else {
      await unregisterSiteScript(site);
      chrome.storage.sync.set({ [site.storageKey]: false });
    }
  }
}

chrome.permissions.onAdded.addListener(syncChatScripts);
chrome.permissions.onRemoved.addListener(syncChatScripts);
chrome.runtime.onStartup.addListener(syncChatScripts);

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'varterm-read-selection',
      title: 'Read with Varterm',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'varterm-read-page',
      title: 'Read entire page',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'varterm-read-youtube',
      title: 'Read this video transcript',
      contexts: ['page'],
      documentUrlPatterns: [
        'https://www.youtube.com/watch*',
        'https://youtube.com/watch*',
        'https://m.youtube.com/watch*'
      ]
    });

    chrome.contextMenus.create({
      id: 'varterm-read-chat',
      title: 'Read the last reply',
      contexts: ['page'],
      documentUrlPatterns: vartermChatOrigins()
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  syncChatScripts();
  createMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'varterm-read-selection') {
    sendToTab(tab?.id, {
      action: 'speak',
      text: info.selectionText
    }, false, tab?.url);
  } else if (info.menuItemId === 'varterm-read-page') {
    sendToTab(tab?.id, { action: 'speakPage' }, false, tab?.url);
  } else if (info.menuItemId === 'varterm-read-youtube') {
    // YouTube navigates between videos without reloading, so the transcript
    // helper may be missing even though the content script is already running.
    // Inject before asking rather than after failing.
    if (!tab?.id) return;
    ensureContentScript(tab.id, (ok) => {
      if (ok) sendToTab(tab.id, { action: 'speakYouTube' }, true, tab.url);
    }, tab.url || '');
  } else if (info.menuItemId === 'varterm-read-chat') {
    if (!tab?.id) return;
    ensureContentScript(tab.id, (ok) => {
      if (ok) sendToTab(tab.id, { action: 'speakChat' }, true, tab.url);
    }, tab.url || '');
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  const action = command === 'read-selection'
    ? { action: 'speakSelection' }
    : command === 'stop-speaking'
    ? { action: 'stop' }
    : command === 'pause-speaking'
    ? { action: 'pause' }
    : command === 'jump-back'
    ? { action: 'stepBack' }
    : command === 'jump-forward'
    ? { action: 'stepForward' }
    : null;
  if (!action) return;

  if (tab?.id) {
    sendToTab(tab.id, action, false, tab?.url);
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      sendToTab(tabs[0].id, action, false, tabs[0]?.url);
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getAudio') {
    fetchAudio(request.text, request.voice, request.rate)
      .then(({ audioBytes, mimeType }) => sendResponse({ success: true, audioBytes, mimeType }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'getSettings') {
    chrome.storage.sync.get(vartermDefaultSettings(), sendResponse);
    return true;
  }

  if (request.action === 'saveSettings') {
    chrome.storage.sync.set(request.settings, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'performTabAction') {
    performTabAction(request.tabAction, sendResponse);
    return true;
  }

  // The popup asks for the permission itself, since that call needs a user
  // gesture. It reports the outcome here so the script registration follows.
  if (request.action === 'setChatAutoRead') {
    (async () => {
      const site = VARTERM_CHAT_SITES.find((s) => s.id === request.site);
      if (!site) {
        sendResponse({ success: false, error: 'Unknown site' });
        return;
      }
      const granted = request.enabled
        ? Boolean(request.granted) || (await hasSitePermission(site))
        : false;
      if (request.enabled && !granted) {
        sendResponse({ success: false, error: 'Permission not granted' });
        return;
      }
      await chrome.storage.sync.set({ [site.storageKey]: !!request.enabled });
      await syncChatScripts();
      sendResponse({ success: true, enabled: !!request.enabled });
    })();
    return true;
  }
});

async function fetchAudio(text, voice, rate) {
  let response;
  try {
    response = await fetch(`${API_ENDPOINT}/api/edge-tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, voice, rate })
    });
  } catch (error) {
    throw new Error('Network error while contacting Varterm TTS');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to generate audio');
  }

  const contentType = response.headers.get('content-type') || '';
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  if (!contentType.includes('audio') || bytes.length < 128) {
    let preview = '';
    try {
      preview = new TextDecoder().decode(bytes.slice(0, 200));
    } catch {
      preview = '';
    }
    throw new Error(`Invalid audio response (${contentType || 'unknown type'}) ${preview}`.trim());
  }

  return {
    audioBytes: Array.from(bytes),
    mimeType: contentType,
  };
}
