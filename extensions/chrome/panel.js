// Varterm TTS Chrome Extension - Reader panel
//
// Shows the text being spoken so it can be followed, searched, and jumped
// around in. Lives in a shadow root because it has to sit on top of pages like
// YouTube without their stylesheets reaching into it, or ours leaking out.
//
// Re-injected on every invocation, so no top-level const/let here either.

var VARTERM_PANEL_ID = 'varterm-reader-panel';
var VARTERM_PANEL_MIN_WIDTH = 300;
var VARTERM_PANEL_MAX_WIDTH = 760;

var vartermPanelState = {
  host: null,
  root: null,
  lines: [],
  partCount: 1,
  activeStart: -1,
  activeEnd: -1,
  matches: [],
  matchCursor: -1,
  matchSummary: '',
  query: '',
  kind: '',
  collapsed: false,
  width: 380,
  handlers: {},
};

function vartermPanelStyles() {
  return `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

    .wrap {
      position: fixed;
      top: 16px;
      right: 16px;
      bottom: 16px;
      width: 380px;
      max-width: calc(100vw - 32px);
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      background: #14141f;
      color: #e6e6ef;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.45);
      overflow: hidden;
      animation: slide 0.18s ease-out;
    }
    @keyframes slide { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: none; } }

    /* Collapsed leaves a compact player and gives the page back. */
    .wrap.mini { bottom: auto; width: 260px; }
    .wrap.mini .searchRow, .wrap.mini .body, .wrap.mini .settings, .wrap.mini .status, .wrap.mini .grip { display: none; }
    .wrap.mini .foot { border-top: none; padding-top: 4px; }

    .grip {
      position: absolute; left: 0; top: 0; bottom: 0; width: 7px;
      cursor: ew-resize; z-index: 2;
    }
    .grip:hover { background: linear-gradient(90deg, rgba(139,92,246,0.5), transparent); }

    .head { display: flex; align-items: center; gap: 6px; padding: 11px 12px 11px 14px; border-bottom: 1px solid rgba(255,255,255,0.09); }
    .mark { width: 8px; height: 16px; border-radius: 2px; background: linear-gradient(135deg,#6366f1,#8b5cf6); flex: none; }
    .title { font-size: 13px; font-weight: 600; line-height: 1.3; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .icon {
      background: none; border: none; color: #9a9ab0; font-size: 13px; line-height: 1; cursor: pointer;
      padding: 4px 6px; border-radius: 5px; flex: none;
    }
    .icon:hover { background: rgba(255,255,255,0.09); color: #fff; }
    .icon.active { background: rgba(99,102,241,0.28); color: #fff; }

    .settings { display: none; padding: 10px 14px; gap: 9px; border-bottom: 1px solid rgba(255,255,255,0.09); flex-direction: column; }
    .settings.open { display: flex; }
    .field { display: flex; align-items: center; gap: 9px; }
    .field label { font-size: 11.5px; color: #9a9ab0; width: 52px; flex: none; }
    .field select {
      flex: 1; background: #0e0e18; border: 1px solid rgba(255,255,255,0.14); color: #e6e6ef;
      border-radius: 6px; padding: 5px 7px; font-size: 12.5px; outline: none; min-width: 0;
    }
    .field select:focus { border-color: #6366f1; }
    .field .val { font-size: 11.5px; color: #9a9ab0; width: 34px; text-align: right; font-variant-numeric: tabular-nums; }

    .searchRow { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-bottom: 1px solid rgba(255,255,255,0.09); }
    .search {
      flex: 1; background: #0e0e18; border: 1px solid rgba(255,255,255,0.14); color: #e6e6ef;
      border-radius: 7px; padding: 7px 10px; font-size: 13px; outline: none; min-width: 0;
    }
    .search:focus { border-color: #6366f1; }
    .search::placeholder { color: #6e6e85; }
    .hits { font-size: 11px; color: #9a9ab0; white-space: nowrap; font-variant-numeric: tabular-nums; }

    .body { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 6px 6px 10px; }
    .body { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.16) transparent; }
    .body::-webkit-scrollbar { width: 6px; }
    .body::-webkit-scrollbar-track { background: transparent; }
    .body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 999px; }
    .body::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
    .body::-webkit-scrollbar-button { display: none; height: 0; }

    /* Parts are what the transport steps through, so they are drawn. */
    .divider {
      display: flex; align-items: center; gap: 8px; cursor: pointer;
      padding: 9px 9px 5px; font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: #7d7d96;
    }
    .divider:hover { color: #b5b5ff; }
    .divider::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.09); }
    .divider.on { color: #b5b5ff; }
    .divider.hidden { display: none; }

    .line {
      display: flex; gap: 9px; padding: 6px 9px; border-radius: 7px; cursor: pointer;
      font-size: 13px; line-height: 1.5; color: #c3c3d4;
    }
    .line:hover { background: rgba(255,255,255,0.06); color: #fff; }
    .line.on { background: rgba(99,102,241,0.19); color: #fff; }
    .line.hidden { display: none; }
    .ts { flex: none; font-size: 11px; color: #7d7d96; padding-top: 2px; min-width: 34px; font-variant-numeric: tabular-nums; }
    .line.on .ts { color: #b5b5ff; }
    .ts.live { cursor: pointer; border-radius: 4px; margin: -1px -3px; padding: 3px; }
    .ts.live:hover { background: rgba(99,102,241,0.4); color: #fff; text-decoration: underline; }
    .tx { min-width: 0; overflow-wrap: anywhere; }
    .tx mark { background: #f5d90a; color: #14141f; border-radius: 2px; padding: 0 1px; }
    .tx mark.cur { background: #ff8a3d; }

    .empty { padding: 18px 14px; font-size: 13px; color: #8a8aa3; text-align: center; }

    .foot { border-top: 1px solid rgba(255,255,255,0.09); padding: 10px 14px 12px; }
    .bar { display: flex; align-items: center; gap: 8px; }
    .btn {
      background: rgba(255,255,255,0.09); border: none; color: #e6e6ef; cursor: pointer;
      width: 30px; height: 30px; border-radius: 7px; font-size: 12px; display: flex; align-items: center; justify-content: center; flex: none;
    }
    .btn:hover { background: rgba(255,255,255,0.17); }
    .btn.main { background: linear-gradient(135deg,#6366f1,#8b5cf6); width: 38px; }
    .btn.main:hover { filter: brightness(1.1); }

    .seek { flex: 1; -webkit-appearance: none; appearance: none; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.17); outline: none; cursor: pointer; min-width: 40px; }
    .seek::-webkit-slider-thumb { -webkit-appearance: none; width: 13px; height: 13px; border-radius: 50%; background: #a5a5ff; cursor: pointer; }
    .time { font-size: 11px; color: #9a9ab0; font-variant-numeric: tabular-nums; white-space: nowrap; flex: none; }

    .status { margin-top: 8px; font-size: 11.5px; color: #8a8aa3; display: flex; justify-content: space-between; gap: 8px; }
    .status.err { color: #fca5a5; }
    .part { color: #9a9ab0; white-space: nowrap; }
  `;
}

// Built element by element rather than from a markup string. Pages such as
// YouTube enforce Trusted Types, where assigning innerHTML throws outright.
function vartermMake(tag, props, children) {
  const el = document.createElement(tag);
  for (const key in props || {}) {
    if (key === 'class') el.className = props[key];
    else if (key === 'text') el.textContent = props[key];
    else el.setAttribute(key, props[key]);
  }
  for (const child of children || []) el.appendChild(child);
  return el;
}

function vartermPanelBuild(options) {
  const head = vartermMake('div', { class: 'head' }, [
    vartermMake('div', { class: 'mark' }),
    vartermMake('div', { class: 'title', id: 'title', text: 'Varterm' }),
    vartermMake('button', { class: 'icon', id: 'gear', title: 'Voice and speed', text: '\u2699' }),
    vartermMake('button', { class: 'icon', id: 'fold', title: 'Collapse', text: '\u2013' }),
    vartermMake('button', { class: 'icon', id: 'close', title: 'Close', text: '\u00d7' }),
  ]);

  const voiceSelect = vartermMake('select', { id: 'voice' });
  for (const voice of options.voices || []) {
    voiceSelect.appendChild(
      vartermMake('option', { value: voice.id, text: vartermVoiceLabel(voice) })
    );
  }

  const tierSelect = vartermMake('select', { id: 'tier' }, [
    vartermMake('option', { value: 'cloud', text: 'Cloud voices' }),
    vartermMake('option', { value: 'browser', text: 'Browser voice' }),
  ]);

  const settings = vartermMake('div', { class: 'settings', id: 'settings' }, [
    vartermMake('div', { class: 'field' }, [
      vartermMake('label', { for: 'tier', text: 'Voices' }),
      tierSelect,
    ]),
    vartermMake('div', { class: 'field', id: 'voiceField' }, [
      vartermMake('label', { for: 'voice', text: 'Voice' }),
      voiceSelect,
    ]),
    vartermMake('div', { class: 'field' }, [
      vartermMake('label', { for: 'rate', text: 'Speed' }),
      vartermMake('input', {
        class: 'seek', id: 'rate', type: 'range', min: '0.5', max: '2', step: '0.1', value: '1',
      }),
      vartermMake('span', { class: 'val', id: 'rateVal', text: '1.0x' }),
    ]),
  ]);

  const searchRow = vartermMake('div', { class: 'searchRow' }, [
    vartermMake('input', {
      class: 'search', id: 'search', type: 'text',
      placeholder: 'Search this text', spellcheck: 'false',
    }),
    vartermMake('span', { class: 'hits', id: 'hits' }),
  ]);

  const bar = vartermMake('div', { class: 'bar' }, [
    vartermMake('button', { class: 'btn', id: 'prev', title: 'Previous part', text: '\u23ee' }),
    vartermMake('button', { class: 'btn main', id: 'toggle', title: 'Pause', text: '\u23f8' }),
    vartermMake('button', { class: 'btn', id: 'next', title: 'Next part', text: '\u23ed' }),
    vartermMake('input', {
      class: 'seek', id: 'seek', type: 'range', min: '0', max: '1000', value: '0',
      title: 'Scrub within this part',
    }),
    vartermMake('span', { class: 'time', id: 'time', text: '0:00' }),
  ]);

  const status = vartermMake('div', { class: 'status' }, [
    vartermMake('span', { id: 'status', text: 'Starting...' }),
    vartermMake('span', { class: 'part', id: 'part' }),
  ]);

  return vartermMake('div', { class: 'wrap', part: 'wrap' }, [
    vartermMake('div', { class: 'grip', id: 'grip', title: 'Drag to resize' }),
    head,
    settings,
    searchRow,
    vartermMake('div', { class: 'body', id: 'body' }),
    vartermMake('div', { class: 'foot' }, [bar, status]),
  ]);
}

function vartermPanelClose() {
  if (vartermPanelState.host) {
    vartermPanelState.host.remove();
    vartermPanelState.host = null;
    vartermPanelState.root = null;
  }
}

function vartermPanelEl(id) {
  return vartermPanelState.root ? vartermPanelState.root.getElementById(id) : null;
}

function vartermPanelIsOpen() {
  return !!vartermPanelState.host && document.documentElement.contains(vartermPanelState.host);
}

function vartermFormatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function vartermPanelApplyLayout() {
  const wrap = vartermPanelState.root && vartermPanelState.root.querySelector('.wrap');
  if (!wrap) return;
  wrap.classList.toggle('mini', vartermPanelState.collapsed);
  if (!vartermPanelState.collapsed) wrap.style.width = `${vartermPanelState.width}px`;

  const fold = vartermPanelEl('fold');
  if (fold) {
    fold.textContent = vartermPanelState.collapsed ? '\u25a1' : '\u2013';
    fold.title = vartermPanelState.collapsed ? 'Expand' : 'Collapse';
  }
}

function vartermPanelOpen(options) {
  vartermPanelClose();

  vartermPanelState.lines = options.lines || [];
  vartermPanelState.partCount = options.partCount || 1;
  vartermPanelState.handlers = options.handlers || {};
  vartermPanelState.activeStart = -1;
  vartermPanelState.activeEnd = -1;
  vartermPanelState.matches = [];
  vartermPanelState.matchCursor = -1;
  vartermPanelState.query = '';
  vartermPanelState.kind = options.kind || '';
  vartermPanelState.collapsed = !!(options.layout && options.layout.collapsed);
  vartermPanelState.width = Math.min(
    VARTERM_PANEL_MAX_WIDTH,
    Math.max(VARTERM_PANEL_MIN_WIDTH, (options.layout && options.layout.width) || 380)
  );

  const host = document.createElement('div');
  host.id = VARTERM_PANEL_ID;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = vartermPanelStyles();
  root.appendChild(style);
  root.appendChild(vartermPanelBuild(options));
  document.documentElement.appendChild(host);

  vartermPanelState.host = host;
  vartermPanelState.root = root;

  vartermPanelEl('title').textContent = options.title || 'Varterm';
  vartermPanelEl('search').placeholder =
    vartermPanelState.kind === 'transcript'
      ? 'Search this transcript'
      : vartermPanelState.partCount > 1
        ? `Search all ${vartermPanelState.partCount} parts`
        : 'Search this text';

  vartermPanelRenderLines();
  vartermPanelApplyLayout();
  vartermPanelWire(options);
}

function vartermPanelWire(options) {
  const handlers = vartermPanelState.handlers;
  const settings = options.settings || {};

  vartermPanelEl('close').addEventListener('click', () => {
    vartermPanelClose();
    if (handlers.onClose) handlers.onClose();
  });

  vartermPanelEl('fold').addEventListener('click', () => {
    vartermPanelState.collapsed = !vartermPanelState.collapsed;
    vartermPanelApplyLayout();
    vartermPanelReportLayout();
  });

  const gear = vartermPanelEl('gear');
  gear.addEventListener('click', () => {
    const strip = vartermPanelEl('settings');
    const open = strip.classList.toggle('open');
    gear.classList.toggle('active', open);
  });

  vartermPanelEl('toggle').addEventListener('click', () => {
    if (handlers.onToggle) handlers.onToggle();
  });
  vartermPanelEl('prev').addEventListener('click', () => {
    if (handlers.onStep) handlers.onStep(-1);
  });
  vartermPanelEl('next').addEventListener('click', () => {
    if (handlers.onStep) handlers.onStep(1);
  });

  const seek = vartermPanelEl('seek');
  seek.addEventListener('input', () => {
    if (handlers.onSeek) handlers.onSeek(Number(seek.value) / 1000);
  });

  // Voice and speed live here so the popup, which covers this panel, is not
  // needed once reading has started.
  const tier = vartermPanelEl('tier');
  const voice = vartermPanelEl('voice');
  const voiceField = vartermPanelEl('voiceField');
  const rate = vartermPanelEl('rate');
  const rateVal = vartermPanelEl('rateVal');

  tier.value = settings.voiceTier || 'cloud';
  voice.value = settings.voice || (options.voices && options.voices[0] && options.voices[0].id) || '';
  rate.value = String(settings.rate || 1);
  rateVal.textContent = `${Number(rate.value).toFixed(1)}x`;
  const syncTier = () => {
    voiceField.style.display = tier.value === 'cloud' ? '' : 'none';
  };
  syncTier();

  tier.addEventListener('change', () => {
    syncTier();
    if (handlers.onSettings) handlers.onSettings({ voiceTier: tier.value });
  });
  voice.addEventListener('change', () => {
    if (handlers.onSettings) handlers.onSettings({ voice: voice.value });
  });
  rate.addEventListener('input', () => {
    rateVal.textContent = `${Number(rate.value).toFixed(1)}x`;
  });
  rate.addEventListener('change', () => {
    if (handlers.onSettings) handlers.onSettings({ rate: Number(rate.value) });
  });

  const search = vartermPanelEl('search');
  search.addEventListener('input', () => vartermPanelSearch(search.value));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      vartermPanelStepMatch(e.shiftKey ? -1 : 1);
    }
    e.stopPropagation();
  });
  // Pages bind their own single-key shortcuts; typing here must not reach them.
  for (const type of ['keypress', 'keyup']) {
    search.addEventListener(type, (e) => e.stopPropagation());
  }

  vartermPanelWireResize();
}

function vartermPanelWireResize() {
  const grip = vartermPanelEl('grip');
  if (!grip) return;

  let dragging = false;

  grip.addEventListener('pointerdown', (e) => {
    dragging = true;
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // The panel is pinned 16px from the right, so its width is whatever is left
    // between the pointer and that edge.
    const width = window.innerWidth - e.clientX - 16;
    vartermPanelState.width = Math.min(
      Math.min(VARTERM_PANEL_MAX_WIDTH, window.innerWidth - 40),
      Math.max(VARTERM_PANEL_MIN_WIDTH, width)
    );
    vartermPanelApplyLayout();
  });

  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try { grip.releasePointerCapture(e.pointerId); } catch {}
    vartermPanelReportLayout();
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

function vartermPanelReportLayout() {
  const handlers = vartermPanelState.handlers;
  if (handlers.onLayout) {
    handlers.onLayout({
      width: vartermPanelState.width,
      collapsed: vartermPanelState.collapsed,
    });
  }
}

function vartermPanelRenderLines() {
  const body = vartermPanelEl('body');
  if (!body) return;

  if (!vartermPanelState.lines.length) {
    body.replaceChildren(vartermMake('div', { class: 'empty', text: 'Nothing to show.' }));
    return;
  }

  const frag = document.createDocumentFragment();
  let lastPart = -1;

  vartermPanelState.lines.forEach((line, i) => {
    const part = typeof line.part === 'number' ? line.part : 0;

    // A divider wherever a new part begins, so the transport's steps are
    // visible rather than implied.
    if (part !== lastPart && vartermPanelState.partCount > 1) {
      const divider = vartermMake('div', {
        class: 'divider',
        'data-part': String(part),
        text: `Part ${part + 1}`,
      });
      divider.addEventListener('click', () => {
        if (vartermPanelState.handlers.onJump) vartermPanelState.handlers.onJump(i);
      });
      frag.appendChild(divider);
      lastPart = part;
    }

    const row = vartermMake('div', { class: 'line', 'data-i': String(i), 'data-part': String(part) });

    if (line.ts) {
      // On a video page the timestamp is a way into the video itself, so it is
      // its own control rather than part of the row's click target.
      const seekable = typeof line.sec === 'number' && vartermPanelState.handlers.onSeekMedia;
      const stamp = vartermMake('span', {
        class: seekable ? 'ts live' : 'ts',
        text: line.ts,
        title: seekable ? `Jump the video to ${line.ts}` : '',
      });
      if (seekable) {
        stamp.addEventListener('click', (e) => {
          e.stopPropagation();
          vartermPanelState.handlers.onSeekMedia(line.sec, line.ts);
        });
      }
      row.appendChild(stamp);
    }

    row.appendChild(vartermMake('span', { class: 'tx', text: line.text }));
    row.addEventListener('click', () => {
      if (vartermPanelState.handlers.onJump) vartermPanelState.handlers.onJump(i);
    });
    frag.appendChild(row);
  });

  body.replaceChildren(frag);
}

function vartermPanelRows() {
  const body = vartermPanelEl('body');
  return body ? Array.from(body.querySelectorAll('.line')) : [];
}

function vartermPanelDividers() {
  const body = vartermPanelEl('body');
  return body ? Array.from(body.querySelectorAll('.divider')) : [];
}

// The player speaks a part at a time, so a run of lines is highlighted rather
// than a single one.
function vartermPanelSetActive(startLine, endLine) {
  vartermPanelState.activeStart = startLine;
  vartermPanelState.activeEnd = endLine;

  const rows = vartermPanelRows();
  let first = null;
  let activePart = null;

  rows.forEach((row) => {
    const i = Number(row.dataset.i);
    const on = i >= startLine && i <= endLine;
    row.classList.toggle('on', on);
    if (on && !first) {
      first = row;
      activePart = row.dataset.part;
    }
  });

  vartermPanelDividers().forEach((d) => {
    d.classList.toggle('on', d.dataset.part === activePart);
  });

  // Never yank the view away while the reader is searching.
  if (first && !vartermPanelState.query) first.scrollIntoView({ block: 'nearest' });
}

function vartermPanelSetProgress(fraction, currentSeconds, totalSeconds) {
  const seek = vartermPanelEl('seek');
  const time = vartermPanelEl('time');
  if (seek && document.activeElement !== vartermPanelState.host) {
    seek.value = String(Math.round((fraction || 0) * 1000));
  }
  if (time) {
    time.textContent = totalSeconds
      ? `${vartermFormatTime(currentSeconds)} / ${vartermFormatTime(totalSeconds)}`
      : vartermFormatTime(currentSeconds);
  }
}

function vartermPanelSetPlaying(playing) {
  const toggle = vartermPanelEl('toggle');
  if (!toggle) return;
  toggle.textContent = playing ? '\u23f8' : '\u25b6';
  toggle.title = playing ? 'Pause' : 'Resume';
}

function vartermPanelSetStatus(text, isError) {
  const status = vartermPanelEl('status');
  if (!status) return;
  status.textContent = text;
  status.parentElement.classList.toggle('err', !!isError);
}

function vartermPanelSetPart(index, total) {
  const part = vartermPanelEl('part');
  if (part) part.textContent = total > 1 ? `Part ${index + 1} of ${total}` : '';
}

// Searches every line of the whole text, not just the part being spoken.
function vartermPanelSearch(query) {
  const needle = (query || '').trim().toLowerCase();
  vartermPanelState.query = needle;
  vartermPanelState.matches = [];
  vartermPanelState.matchCursor = -1;

  const partsWithHits = new Set();

  vartermPanelRows().forEach((row) => {
    const i = Number(row.dataset.i);
    const line = vartermPanelState.lines[i];
    const tx = row.querySelector('.tx');
    if (!line || !tx) return;

    if (!needle) {
      tx.textContent = line.text;
      row.classList.remove('hidden');
      return;
    }

    const hit = line.text.toLowerCase().includes(needle);
    row.classList.toggle('hidden', !hit);
    if (!hit) {
      tx.textContent = line.text;
      return;
    }

    vartermPanelState.matches.push(i);
    partsWithHits.add(row.dataset.part);

    // Rebuilt as text nodes plus <mark>, so page text can never inject markup.
    tx.replaceChildren();
    let rest = line.text;
    let at = rest.toLowerCase().indexOf(needle);
    while (at !== -1) {
      tx.appendChild(document.createTextNode(rest.slice(0, at)));
      tx.appendChild(vartermMake('mark', { text: rest.slice(at, at + needle.length) }));
      rest = rest.slice(at + needle.length);
      at = rest.toLowerCase().indexOf(needle);
    }
    tx.appendChild(document.createTextNode(rest));
  });

  // Keep the heading of any part that has a hit, so results stay attributable
  // to where they are in the text.
  vartermPanelDividers().forEach((d) => {
    d.classList.toggle('hidden', !!needle && !partsWithHits.has(d.dataset.part));
  });

  // Naming the parts a term was found in is what makes it obvious the search
  // covered the whole text and not just the part being spoken.
  const parts = partsWithHits.size;
  vartermPanelState.matchSummary =
    vartermPanelState.kind === 'transcript'
      ? ' in transcript'
      : vartermPanelState.partCount > 1 ? ` in ${parts} part${parts === 1 ? '' : 's'}` : '';

  const hits = vartermPanelEl('hits');
  if (hits) {
    if (!needle) hits.textContent = '';
    else if (!vartermPanelState.matches.length) hits.textContent = 'none';
  }

  if (needle && vartermPanelState.matches.length) vartermPanelStepMatch(1);
}

function vartermPanelStepMatch(direction) {
  const matches = vartermPanelState.matches;
  if (!matches.length) return;

  vartermPanelState.matchCursor =
    (vartermPanelState.matchCursor + direction + matches.length) % matches.length;
  const lineIndex = matches[vartermPanelState.matchCursor];

  const rows = vartermPanelRows();
  rows.forEach((row) => {
    row.querySelectorAll('mark').forEach((m) => m.classList.remove('cur'));
  });
  const row = rows.find((r) => Number(r.dataset.i) === lineIndex);
  if (row) {
    row.querySelectorAll('mark').forEach((m) => m.classList.add('cur'));
    row.scrollIntoView({ block: 'center' });
  }

  const hits = vartermPanelEl('hits');
  if (hits) {
    hits.textContent =
      `${vartermPanelState.matchCursor + 1} of ${matches.length}${vartermPanelState.matchSummary}`;
  }
}
