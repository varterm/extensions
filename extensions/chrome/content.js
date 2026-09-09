// Varterm TTS Chrome Extension - Content Script

let audio = null;
let isPaused = false;
let floatingButton = null;
let currentAudioUrl = null;
let webAudioContext = null;
let webAudioSource = null;

// Long text is read as a sequence of parts. Stopping bumps the token so audio
// and fetches still in flight from an earlier run know to abandon themselves.
let playToken = 0;

// A whole video transcript is far past what one request can carry, so text is
// split at sentence boundaries and the next part is fetched while the current
// one plays. Parts are kept small because they are also the unit you jump to,
// and a large part means a coarse jump and a slow first word.
const PART_SIZE = 1500;

// Played parts are kept so scrubbing backwards does not re-synthesize, capped
// because an hour-long transcript would otherwise sit in memory in full.
const PART_CACHE_LIMIT = 40;

const reader = {
  lines: [],
  parts: [],
  index: 0,
  cache: new Map(),
  paused: false,
  active: false,
  panelOpen: false,
  title: '',
  layout: { width: 380, collapsed: false }
};

// Settings
let settings = {
  voiceTier: 'cloud',
  voice: 'en-US-AriaNeural',
  rate: 1.0,
  stripMarkdown: true
};

// Load settings
chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
  if (response) settings = { ...settings, ...response };
  // A saved preference can outlive the voice it names.
  if (typeof vartermNormalizeVoice === 'function') {
    settings.voice = vartermNormalizeVoice(settings.voice);
  }
  setUpClaude();
  setUpChat();
});

// On claude.ai, put a Varterm control under each reply, and read new replies
// aloud if that was switched on. Replies already on screen are never read, so
// opening an old conversation stays quiet.
function setUpClaude() {
  if (typeof vartermIsClaude !== 'function' || !vartermIsClaude()) return;

  const read = (text, title) => speakText(text, { title });

  // Replies arrive without a page load, so the buttons are topped up rather
  // than added once.
  vartermClaudeAddButtons(read);
  setInterval(() => vartermClaudeAddButtons(read), 2000);

  applyClaudeAutoRead();
}

function applyClaudeAutoRead() {
  if (typeof vartermIsClaude !== 'function' || !vartermIsClaude()) return;
  if (typeof vartermClaudeWatch !== 'function') return;

  if (settings.autoReadClaude) {
    vartermClaudeWatch((text, title) => speakText(text, { title }));
  } else {
    vartermClaudeUnwatch();
  }
}

function setUpChat() {
  if (typeof vartermChatActive !== 'function') return;
  const site = vartermChatActive();
  if (!site) return;

  const read = (text, title) => speakText(text, { title });
  vartermChatAddButtons(site, read);
  setInterval(() => vartermChatAddButtons(site, read), 2000);
  applyChatAutoRead();
}

function applyChatAutoRead() {
  if (typeof vartermChatActive !== 'function' || typeof vartermChatWatch !== 'function') return;
  const site = vartermChatActive();
  if (!site) return;

  if (settings[site.storageKey]) {
    vartermChatWatch(site, (text, title) => speakText(text, { title }));
  } else {
    vartermChatUnwatch();
  }
}

// The toggle lives in the popup, which cannot reach an already-open tab. Every
// tab watches the stored setting instead, so switching it takes effect without
// a reload.
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let chatChanged = false;
    for (const key of Object.keys(changes)) {
      if (!key.startsWith('autoRead')) continue;
      settings[key] = changes[key].newValue;
      if (key === 'autoReadClaude') applyClaudeAutoRead();
      else chatChanged = true;
    }
    if (chatChanged) applyChatAutoRead();
  });
}

// Panel size and collapsed state are the reader's own preference, remembered
// across pages rather than reset on every read.
if (chrome.storage && chrome.storage.sync) {
  chrome.storage.sync.get({ panelLayout: null }, (stored) => {
    if (stored && stored.panelLayout) reader.layout = stored.panelLayout;
  });
}

function saveLayout(layout) {
  reader.layout = { ...reader.layout, ...layout };
  if (chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.set({ panelLayout: reader.layout }, () => void chrome.runtime.lastError);
  }
}

function applySettingsFromPanel(change) {
  settings = { ...settings, ...change };
  chrome.runtime.sendMessage(
    { action: 'saveSettings', settings },
    () => void chrome.runtime.lastError
  );

  // Audio already generated speaks in the old voice and speed, so it cannot be
  // reused. Drop it and say the current part again the new way.
  reader.cache.clear();
  if (reader.active) playFrom(reader.index);
}

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'speak':
      speakText(request.text);
      sendResponse({ success: true });
      break;
    case 'speakSelection':
      speakSelection();
      sendResponse({ success: true });
      break;
    case 'speakPage':
      speakPage();
      sendResponse({ success: true });
      break;
    case 'speakYouTube':
      speakYouTubeTranscript();
      sendResponse({ success: true });
      break;
    case 'speakClaude':
      speakClaudeReply();
      sendResponse({ success: true });
      break;
    case 'speakChat':
      speakChatReply();
      sendResponse({ success: true });
      break;
    case 'isClaude':
      sendResponse({
        success: true,
        isClaude: typeof vartermIsClaude === 'function' && vartermIsClaude()
      });
      break;
    case 'isYouTubeVideo':
      sendResponse({
        success: true,
        isVideo: typeof vartermIsYouTubeWatch === 'function' && vartermIsYouTubeWatch()
      });
      break;
    case 'stop':
      stopSpeaking();
      sendResponse({ success: true });
      break;
    case 'pause':
      togglePause();
      sendResponse({ success: true });
      break;
    case 'stepBack':
      sendResponse({ success: stepReading(-1) });
      break;
    case 'stepForward':
      sendResponse({ success: stepReading(1) });
      break;
    case 'updateSettings':
      settings = { ...settings, ...request.settings };
      applyClaudeAutoRead();
      applyChatAutoRead();
      if (request.replay && reader.active) {
        reader.cache.clear();
        playFrom(reader.index);
      }
      sendResponse({ success: true });
      break;
    default:
      sendResponse({ success: false, error: 'Unknown action' });
      break;
  }
  return true;
});

// Chrome keeps Ctrl+Shift+R / Cmd+Shift+R for hard reload, so that combo
// never reaches the extension command. Alt+Shift+R is the read shortcut;
// handle it here as well as via chrome.commands, so it works even when
// Chrome did not assign the suggested key (common after an upgrade).
document.addEventListener('keydown', (e) => {
  if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
  if (e.code !== 'KeyR' && e.key !== 'r' && e.key !== 'R') return;
  e.preventDefault();
  e.stopPropagation();
  speakSelection();
}, true);

// Show floating button on text selection
document.addEventListener('mouseup', (e) => {
  const selection = window.getSelection();
  const text = selection.toString().trim();
  
  if (text.length > 0 && text.length < 50000) {
    showFloatingButton(e.clientX, e.clientY, text);
  } else {
    hideFloatingButton();
  }
});

document.addEventListener('mousedown', (e) => {
  if (floatingButton && !floatingButton.contains(e.target)) {
    hideFloatingButton();
  }
});

function showFloatingButton(x, y, text) {
  hideFloatingButton();
  
  floatingButton = document.createElement('div');
  floatingButton.className = 'varterm-floating-btn';
  // textContent, not innerHTML: pages that enforce Trusted Types reject the latter.
  floatingButton.textContent = '🔊';
  floatingButton.title = 'Read with Varterm';
  
  // Position near cursor
  floatingButton.style.left = `${Math.min(x + 10, window.innerWidth - 50)}px`;
  floatingButton.style.top = `${Math.min(y - 40, window.innerHeight - 50)}px`;
  
  floatingButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    speakText(text);
    hideFloatingButton();
  });
  
  document.body.appendChild(floatingButton);
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    if (floatingButton) hideFloatingButton();
  }, 3000);
}

function hideFloatingButton() {
  if (floatingButton) {
    floatingButton.remove();
    floatingButton = null;
  }
}

function sanitizeMarkdown(text) {
  if (!settings.stripMarkdown) return text;
  
  let result = text;
  result = result.replace(/```[\s\S]*?```/g, ' code block ');
  result = result.replace(/`([^`]+)`/g, '$1');
  result = result.replace(/^#{1,6}\s+/gm, '');
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/\*([^*]+)\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');
  result = result.replace(/_([^_]+)_/g, '$1');
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  result = result.replace(/^\s*[-*+]\s+/gm, '');
  result = result.replace(/^\s*\d+\.\s+/gm, '');
  result = result.replace(/^\s*>\s+/gm, '');
  result = result.replace(/^---+$/gm, '');
  result = result.replace(/\n{3,}/g, '\n\n');
  
  return result.trim();
}

function showStatus(message, isError = false) {
  // Remove existing status
  const existing = document.querySelector('.varterm-status');
  if (existing) existing.remove();
  
  const status = document.createElement('div');
  status.className = `varterm-status ${isError ? 'varterm-error' : ''}`;
  status.textContent = message;
  document.body.appendChild(status);
  
  setTimeout(() => status.remove(), 3000);
}

function splitIntoChunks(text, maxSize = PART_SIZE) {
  if (text.length <= maxSize) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxSize) {
    const head = remaining.slice(0, maxSize);

    // Prefer to break where a sentence ends so a part never stops mid-thought.
    // Auto-generated captions carry no punctuation at all, so falling back to a
    // word boundary is the normal case rather than the exception.
    let breakPoint = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
    if (breakPoint > maxSize * 0.5) {
      breakPoint += 2;
    } else {
      const lastSpace = head.lastIndexOf(' ');
      breakPoint = lastSpace > maxSize * 0.5 ? lastSpace + 1 : maxSize;
    }

    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

// Break text into the lines the panel shows. Every line is kept at or under a
// part's worth of characters so a single line always fits inside one part.
function buildLines(text) {
  const lines = [];
  for (const block of text.split(/\n+/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const sentences = trimmed.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [trimmed];
    let buffer = '';
    for (const sentence of sentences) {
      const next = (buffer + sentence).trim();
      if (next.length > PART_SIZE) {
        if (buffer.trim()) lines.push({ text: buffer.trim(), ts: null });
        for (const piece of splitIntoChunks(sentence.trim(), PART_SIZE)) {
          lines.push({ text: piece, ts: null });
        }
        buffer = '';
      } else {
        buffer = next + ' ';
      }
    }
    if (buffer.trim()) lines.push({ text: buffer.trim(), ts: null });
  }
  return lines.length ? lines : [{ text: text.trim(), ts: null }];
}

// Group lines into the units actually sent for synthesis. Parts stay small so
// the first words arrive quickly and jumping lands near where you clicked.
function buildParts(lines) {
  const parts = [];
  let current = null;

  lines.forEach((line, i) => {
    if (current && (current.text.length + line.text.length + 1) > PART_SIZE) {
      parts.push(current);
      current = null;
    }
    if (!current) current = { text: '', firstLine: i, lastLine: i };
    current.text = current.text ? `${current.text} ${line.text}` : line.text;
    current.lastLine = i;
  });

  if (current) parts.push(current);
  return parts;
}

function partIndexOf(parts, lineIndex) {
  for (let i = 0; i < parts.length; i++) {
    if (lineIndex >= parts[i].firstLine && lineIndex <= parts[i].lastLine) return i;
  }
  return 0;
}

function partForLine(lineIndex) {
  return partIndexOf(reader.parts, lineIndex);
}

// Status goes to the panel when it is open, and to the small toast otherwise.
function report(message, isError) {
  if (reader.panelOpen && typeof vartermPanelSetStatus === 'function') {
    vartermPanelSetStatus(message, isError);
    if (isError) showStatus(message, true);
    return;
  }
  showStatus(message, isError);
}

function speakText(text, options = {}) {
  if (!text || !text.trim()) {
    showStatus('No text to read', true);
    return;
  }

  const sanitized = sanitizeMarkdown(text);
  const lines = options.lines && options.lines.length ? options.lines : buildLines(sanitized);
  startReading(lines, options);
}

function startReading(lines, options = {}) {
  stopSpeaking();

  reader.parts = buildParts(lines);

  // Tag each line with the part that speaks it, so the panel can draw the
  // boundaries the transport steps through.
  reader.lines = lines.map((line, i) => ({ ...line, part: partIndexOf(reader.parts, i) }));
  reader.cache.clear();
  reader.paused = false;
  reader.active = true;
  reader.title = options.title || document.title;

  // A short selection does not need a panel over the page; long text does.
  const total = lines.reduce((n, l) => n + l.text.length, 0);
  const wantPanel = options.panel !== false && (options.panel === true || total > 400);
  reader.panelOpen = false;

  if (wantPanel && typeof vartermPanelOpen === 'function') {
    vartermPanelOpen({
      title: reader.title,
      lines: reader.lines,
      partCount: reader.parts.length,
      voices: typeof VARTERM_VOICES !== 'undefined' ? VARTERM_VOICES : [],
      settings: settings,
      layout: reader.layout,
      handlers: {
        onJump: (lineIndex) => playFrom(partForLine(lineIndex), offsetOfLineInPart(lineIndex)),
        onToggle: () => togglePause(),
        onStep: (delta) => playFrom(reader.index + delta),
        onSeek: (fraction) => seekWithinPart(fraction),
        onClose: () => stopSpeaking(),
        onSeekMedia: (seconds, label) => seekPageMedia(seconds, label),
        onSettings: (change) => applySettingsFromPanel(change),
        onLayout: (layout) => saveLayout(layout),
      },
      kind: options.kind || '',
    });
    reader.panelOpen = true;
    vartermPanelSetPlaying(true);
    vartermPanelSetPart(0, reader.parts.length);
  }

  playFrom(0);
}

function stepReading(delta) {
  if (!reader.parts.length) {
    showStatus('Nothing is playing', true);
    return false;
  }
  playFrom(reader.index + delta);
  return true;
}

function playFrom(index, startFraction = 0) {
  if (!reader.parts.length) return;
  const target = Math.max(0, Math.min(index, reader.parts.length - 1));

  stopAudioOnly();
  reader.index = target;
  reader.paused = false;
  if (reader.panelOpen) vartermPanelSetPlaying(true);

  runFrom(target, startFraction);
}

// A part is one audio file, so clicking a line partway through it would
// otherwise restart the whole part. Where the line sits in the part's text is
// a good enough stand-in for where it sits in the audio.
function offsetOfLineInPart(lineIndex) {
  const part = reader.parts[partForLine(lineIndex)];
  if (!part) return 0;

  let before = 0;
  let total = 0;
  for (let i = part.firstLine; i <= part.lastLine; i++) {
    const length = reader.lines[i].text.length + 1;
    if (i < lineIndex) before += length;
    total += length;
  }
  return total ? before / total : 0;
}

async function getPart(index) {
  if (reader.cache.has(index)) return reader.cache.get(index);

  const payload = await fetchCloudAudio(reader.parts[index].text);

  // Keep replayable audio around, but not without limit on a long transcript.
  if (reader.cache.size >= PART_CACHE_LIMIT) {
    const oldest = reader.cache.keys().next().value;
    reader.cache.delete(oldest);
  }
  reader.cache.set(index, payload);
  return payload;
}

async function runFrom(start, startFraction = 0) {
  const token = ++playToken;
  const total = reader.parts.length;

  try {
    if (settings.voiceTier === 'browser') {
      for (let i = start; i < total; i++) {
        if (token !== playToken) return;
        markPart(i, total);
        await speakWithBrowser(reader.parts[i].text);
        if (token !== playToken) return;
      }
      finish(token);
      return;
    }

    report(total > 1 ? `Generating part ${start + 1} of ${total}...` : 'Generating audio...');
    let pending = getPart(start);

    for (let i = start; i < total; i++) {
      const payload = await pending;
      if (token !== playToken) return;

      // Start the next request before playing, so parts run together.
      if (i + 1 < total) pending = getPart(i + 1);

      markPart(i, total);
      await playCloudAudio(
        payload,
        total > 1 ? `Speaking part ${i + 1} of ${total}` : 'Speaking...',
        i === start ? startFraction : 0
      );
      if (token !== playToken) return;
    }
    finish(token);
  } catch (error) {
    if (token !== playToken) return;
    console.error('Varterm TTS Error:', error);
    report(error.message || 'Failed to generate audio', true);
  }
}

function markPart(index, total) {
  reader.index = index;
  if (!reader.panelOpen) return;
  const part = reader.parts[index];
  vartermPanelSetActive(part.firstLine, part.lastLine);
  vartermPanelSetPart(index, total);
}

function finish(token) {
  if (token !== playToken) return;
  reader.active = false;
  report('Done');
  if (reader.panelOpen) vartermPanelSetPlaying(false);
}

// Captions carry the time they were spoken, so a line found by searching is
// also a place in the video. Content scripts share the page's DOM, so the
// player can be moved directly. Its play state is left alone: someone reading
// a transcript has usually paused it, and starting it would talk over the
// voice.
function seekPageMedia(seconds, label) {
  if (!isFinite(seconds)) return;

  const video =
    document.querySelector('video.html5-main-video') ||
    Array.from(document.querySelectorAll('video'))
      .filter((v) => v.clientWidth > 0)
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];

  if (!video) {
    report('No video on this page', true);
    return;
  }

  // An ad plays through the same element, so seeking during one only winds the
  // ad forward: the position clamps to the ad's length, not the video's.
  const adPlaying = !!document.querySelector('.ad-showing, .ytp-ad-player-overlay-layout');
  if (adPlaying || (isFinite(video.duration) && seconds > video.duration)) {
    report('Waiting for the ad to finish', true);
    return;
  }

  try {
    video.currentTime = seconds;
    report(label ? `Video at ${label}` : 'Video moved');
  } catch {
    report('Could not move the video', true);
  }
}

function seekWithinPart(fraction) {
  if (audio && isFinite(audio.duration)) {
    audio.currentTime = Math.max(0, Math.min(fraction, 1)) * audio.duration;
  }
}

function speakWithBrowser(text) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('Browser TTS not supported'));
      return;
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = settings.rate;
    
    utterance.onstart = () => showStatus('Speaking...');
    utterance.onend = () => {
      showStatus('Done');
      resolve();
    };
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted') {
        reject(new Error('Speech synthesis failed'));
      }
    };
    
    window.speechSynthesis.speak(utterance);
  });
}

async function fetchCloudAudio(text) {
  const response = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'getAudio',
      text: text,
      voice: settings.voice,
      rate: settings.rate
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response || !response.success) {
        reject(new Error((response && response.error) || 'No response from Varterm'));
      } else {
        resolve(response);
      }
    });
  });

  const audioBytes = response.audioBytes;
  if (!audioBytes || !audioBytes.length) {
    throw new Error('No audio data returned');
  }

  const byteArray = new Uint8Array(audioBytes);
  if (byteArray.length < 128) {
    throw new Error('Received invalid audio payload');
  }

  const rawMimeType = response.mimeType || 'audio/mpeg';
  return { byteArray, mimeType: rawMimeType.split(';')[0].trim() || 'audio/mpeg' };
}

// Resolves when this part has finished playing, so the caller can start the
// next one without talking over it.
async function playCloudAudio({ byteArray, mimeType }, label, startFraction = 0) {
  const release = () => {
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = null;
    }
    audio = null;
    isPaused = false;
  };

  const element = new Audio();
  audio = element;
  element.preload = 'auto';
  currentAudioUrl = URL.createObjectURL(new Blob([byteArray], { type: mimeType }));
  element.src = currentAudioUrl;

  if (startFraction > 0) {
    element.onloadedmetadata = () => {
      if (isFinite(element.duration)) element.currentTime = startFraction * element.duration;
    };
  }

  const finished = new Promise((resolve, reject) => {
    element.onplay = () => report(label);
    element.onended = () => {
      release();
      resolve();
    };
    element.onerror = () => {
      release();
      reject(new Error('Audio playback failed'));
    };
  });

  if (reader.panelOpen && typeof vartermPanelSetProgress === 'function') {
    element.ontimeupdate = () => {
      const total = isFinite(element.duration) ? element.duration : 0;
      vartermPanelSetProgress(total ? element.currentTime / total : 0, element.currentTime, total);
    };
  }

  try {
    element.load();
    await element.play();
    return finished;
  } catch (playError) {
    if ((playError?.name || '') === 'NotAllowedError') {
      release();
      throw new Error('Playback blocked on this page. Click anywhere, then try again.');
    }

    // Some pages reject the provider's mime parameters, so retry as plain mp3.
    if (mimeType !== 'audio/mpeg') {
      try {
        URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = URL.createObjectURL(new Blob([byteArray], { type: 'audio/mpeg' }));
        element.src = currentAudioUrl;
        element.load();
        await element.play();
        return finished;
      } catch {
        // fall through to Web Audio
      }
    }

    release();
    await playWithWebAudio(byteArray);
  }
}

async function playWithWebAudio(byteArray) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Audio format not supported on this page.');
  }

  if (!webAudioContext) {
    webAudioContext = new AudioCtx();
  }

  if (webAudioContext.state === 'suspended') {
    await webAudioContext.resume();
  }

  if (webAudioSource) {
    try {
      webAudioSource.stop();
    } catch {}
    webAudioSource = null;
  }

  const decodeBuffer = byteArray.slice().buffer;
  const audioBuffer = await webAudioContext.decodeAudioData(decodeBuffer);
  const source = webAudioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(webAudioContext.destination);

  webAudioSource = source;
  showStatus('Speaking...');

  // Resolve only when this part finishes, so the next one does not start over it.
  await new Promise((resolve) => {
    source.onended = () => {
      if (webAudioSource === source) webAudioSource = null;
      resolve();
    };
    source.start(0);
  });
}

function speakSelection() {
  const selection = window.getSelection();
  const text = selection.toString().trim();
  
  if (text) {
    speakText(text);
  } else {
    showStatus('No text selected', true);
  }
}

function speakClaudeReply() {
  if (typeof vartermClaudeLatest !== 'function') {
    showStatus('Claude support did not load. Reload the page.', true);
    return;
  }

  const result = vartermClaudeLatest();
  if (!result.ok) {
    showStatus(result.message, true);
    return;
  }
  speakText(result.text, { title: result.title });
}

function speakChatReply() {
  if (typeof vartermIsClaude === 'function' && vartermIsClaude()) {
    speakClaudeReply();
    return;
  }
  if (typeof vartermChatLatest !== 'function') {
    showStatus('Chat support did not load. Reload the page.', true);
    return;
  }

  const result = vartermChatLatest();
  if (!result.ok) {
    showStatus(result.message, true);
    return;
  }
  speakText(result.text, { title: result.title });
}

async function speakYouTubeTranscript() {
  if (typeof vartermGetYouTubeTranscript !== 'function') {
    showStatus('YouTube support did not load. Reload the page.', true);
    return;
  }

  showStatus('Opening transcript...');
  let result;
  try {
    result = await vartermGetYouTubeTranscript();
  } catch (error) {
    console.error('Varterm YouTube Error:', error);
    showStatus('Could not read this transcript', true);
    return;
  }

  if (!result.ok) {
    showStatus(result.message, true);
    return;
  }

  // Caption rows are already the natural lines, timestamps and all, so the
  // panel shows them as they appear on the video rather than re-split prose.
  startReading(result.lines, { title: result.title, panel: true, kind: 'transcript' });
}

function speakPage() {
  // Get main content, avoiding nav, footer, etc.
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.content',
    '.post-content',
    '.article-content',
    '#content'
  ];
  
  let content = null;
  for (const selector of selectors) {
    content = document.querySelector(selector);
    if (content) break;
  }
  
  if (!content) {
    content = document.body;
  }
  
  // Extract text, skipping scripts, styles, and hidden elements
  const text = getVisibleText(content);
  
  if (text.length > 100000) {
    showStatus('Page too long. Select specific text instead.', true);
    return;
  }
  
  speakText(text);
}

function getVisibleText(element) {
  const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'NAV', 'FOOTER', 'HEADER'];
  
  let text = '';
  
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (skipTags.includes(node.tagName)) continue;
      if (getComputedStyle(node).display === 'none') continue;
      if (getComputedStyle(node).visibility === 'hidden') continue;
      
      text += getVisibleText(node);
      
      // Add spacing for block elements
      if (['P', 'DIV', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI'].includes(node.tagName)) {
        text += '\n';
      }
    }
  }
  
  return text.replace(/\s+/g, ' ').trim();
}

// Silence what is playing without discarding the queue, so a jump can start a
// new part immediately.
function stopAudioOnly() {
  playToken++;

  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audio = null;
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
  if (webAudioSource) {
    try {
      webAudioSource.stop();
    } catch {}
    webAudioSource = null;
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  isPaused = false;
}

function stopSpeaking() {
  stopAudioOnly();

  reader.active = false;
  reader.paused = false;
  reader.cache.clear();

  if (reader.panelOpen) {
    reader.panelOpen = false;
    if (typeof vartermPanelClose === 'function') vartermPanelClose();
  }
}

function togglePause() {
  if (audio) {
    if (isPaused) {
      audio.play();
      isPaused = false;
      reader.paused = false;
      report('Speaking...');
    } else {
      audio.pause();
      isPaused = true;
      reader.paused = true;
      report('Paused');
    }
  } else if (webAudioSource) {
    report('Pause unavailable for this page', true);
    return;
  } else if (window.speechSynthesis && window.speechSynthesis.speaking) {
    if (isPaused) {
      window.speechSynthesis.resume();
      isPaused = false;
      reader.paused = false;
      report('Speaking...');
    } else {
      window.speechSynthesis.pause();
      isPaused = true;
      reader.paused = true;
      report('Paused');
    }
  } else {
    return;
  }

  if (reader.panelOpen && typeof vartermPanelSetPlaying === 'function') {
    vartermPanelSetPlaying(!isPaused);
  }
}
