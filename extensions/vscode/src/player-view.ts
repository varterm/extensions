import * as vscode from 'vscode';

export const PLAYER_VIEW_ID = 'varterm.player';

export type PlayerHostMessage =
  | { type: 'loading'; label: string }
  | { type: 'ready'; label: string; tracks: Array<{ title: string; base64: string }>; voiceName: string; provider: 'edge' | 'premium' }
  | { type: 'error'; label: string; message: string }
  | { type: 'needText' };

export class VartermPlayerViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private pending?: PlayerHostMessage;

  constructor(private readonly onMessage: (message: Record<string, unknown>) => void | Promise<void>) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = buildPlayerHtml();
    webviewView.webview.onDidReceiveMessage((message) => {
      void this.onMessage(message as Record<string, unknown>);
    });
    if (this.pending) {
      void webviewView.webview.postMessage(this.pending);
      this.pending = undefined;
    }
  }

  post(message: PlayerHostMessage): void {
    if (!this.view) {
      this.pending = message;
      return;
    }

    this.view.show?.(true);
    void this.view.webview.postMessage(message);
  }
}

export function buildPlayerHtml(): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        padding: 12px 14px 16px;
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
      }
      .row { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
      .title { font-size: 13px; font-weight: 600; }
      .meta, .status { font-size: 12px; opacity: 0.78; margin-top: 4px; }
      .status.error { color: var(--vscode-errorForeground); opacity: 1; }
      .transport {
        display: grid;
        grid-template-columns: 112px 88px 88px 1fr;
        gap: 8px;
        align-items: center;
        margin-top: 12px;
      }
      button, select, textarea {
        font-family: inherit;
        font-size: 12px;
        color: var(--vscode-foreground);
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, transparent);
        border-radius: 6px;
      }
      button { min-height: 36px; cursor: pointer; }
      #playBtn {
        min-height: 42px;
        font-size: 15px;
        font-weight: 700;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
      }
      #playBtn:disabled { opacity: 0.45; cursor: default; }
      #playBtn:not(:disabled):hover { background: var(--vscode-button-hoverBackground); }
      #seek { width: 100%; margin-top: 8px; }
      #pasteBox {
        width: 100%;
        min-height: 72px;
        margin-top: 10px;
        padding: 8px;
        box-sizing: border-box;
        resize: vertical;
      }
      .actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-top: 8px; }
      audio { display: none; }
    </style>
  </head>
  <body>
    <div class="row">
      <div class="title">Varterm Player</div>
      <div class="meta" id="partMeta"></div>
    </div>
    <div class="meta" id="labelMeta">Paste text below, or use a read command.</div>
    <div class="transport">
      <button id="playBtn" type="button" disabled>Play</button>
      <button id="pauseBtn" type="button" disabled>Pause</button>
      <button id="stopBtn" type="button" disabled>Stop</button>
      <div class="meta" id="timeMeta">0:00 / 0:00</div>
    </div>
    <input id="seek" type="range" min="0" max="1000" value="0" disabled />
    <audio id="player"></audio>
    <div id="status" class="status">Ready. Audio stays in the editor.</div>
    <textarea id="pasteBox" placeholder="Paste text here, then press Read pasted text."></textarea>
    <div class="actions">
      <button id="readPastedBtn" type="button">Read pasted text</button>
      <button id="readClipboardBtn" type="button">Read clipboard</button>
      <button id="readEditorBtn" type="button">Read editor</button>
    </div>
    <script>
      const vscodeApi = acquireVsCodeApi();
      const player = document.getElementById('player');
      const playBtn = document.getElementById('playBtn');
      const pauseBtn = document.getElementById('pauseBtn');
      const stopBtn = document.getElementById('stopBtn');
      const seek = document.getElementById('seek');
      const statusEl = document.getElementById('status');
      const labelMeta = document.getElementById('labelMeta');
      const partMeta = document.getElementById('partMeta');
      const timeMeta = document.getElementById('timeMeta');
      const pasteBox = document.getElementById('pasteBox');
      let tracks = [];
      let trackIndex = 0;
      let objectUrl = '';
      let seeking = false;

      function formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
        const total = Math.floor(seconds);
        const m = Math.floor(total / 60);
        const s = String(total % 60).padStart(2, '0');
        return m + ':' + s;
      }

      function setStatus(text, isError) {
        statusEl.textContent = text;
        statusEl.className = isError ? 'status error' : 'status';
      }

      function revoke() {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = '';
        }
      }

      function setReadyControls(enabled) {
        playBtn.disabled = !enabled;
        pauseBtn.disabled = !enabled;
        stopBtn.disabled = !enabled;
        seek.disabled = !enabled;
      }

      function toObjectUrl(base64Audio) {
        const binary = atob(base64Audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        revoke();
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
        return objectUrl;
      }

      function loadTrack(index, autoplay) {
        const track = tracks[index];
        if (!track) return;
        trackIndex = index;
        player.src = toObjectUrl(track.base64);
        player.load();
        partMeta.textContent = (index + 1) + '/' + tracks.length;
        setReadyControls(true);
        playBtn.textContent = 'Play';
        if (autoplay) {
          void tryPlay();
        } else {
          setStatus('Ready. Press Play.');
        }
      }

      async function tryPlay() {
        try {
          player.muted = false;
          await player.play();
          playBtn.textContent = 'Playing';
          setStatus('Playing.');
        } catch (error) {
          playBtn.textContent = 'Play';
          setStatus('Ready. Press Play to start.');
        }
      }

      playBtn.addEventListener('click', () => { void tryPlay(); });
      pauseBtn.addEventListener('click', () => {
        player.pause();
        playBtn.textContent = 'Play';
        setStatus('Paused.');
      });
      stopBtn.addEventListener('click', () => {
        player.pause();
        player.currentTime = 0;
        playBtn.textContent = 'Play';
        setStatus('Stopped.');
      });
      seek.addEventListener('input', () => {
        seeking = true;
        if (player.duration) {
          player.currentTime = (Number(seek.value) / 1000) * player.duration;
        }
      });
      seek.addEventListener('change', () => { seeking = false; });
      player.addEventListener('timeupdate', () => {
        if (!seeking && player.duration) {
          seek.value = String(Math.round((player.currentTime / player.duration) * 1000));
        }
        timeMeta.textContent = formatTime(player.currentTime) + ' / ' + formatTime(player.duration);
      });
      player.addEventListener('play', () => {
        playBtn.textContent = 'Playing';
        setStatus('Playing.');
      });
      player.addEventListener('ended', () => {
        if (trackIndex + 1 < tracks.length) {
          loadTrack(trackIndex + 1, true);
          return;
        }
        playBtn.textContent = 'Play';
        setStatus('Finished.');
      });
      player.addEventListener('error', () => {
        const code = player.error ? player.error.code : 'unknown';
        setReadyControls(false);
        setStatus('Could not play audio (code ' + code + '). Try Read again.', true);
        vscodeApi.postMessage({ type: 'playerError', detail: 'HTML audio playback error (code: ' + code + ')' });
      });

      document.getElementById('readPastedBtn').addEventListener('click', () => {
        const text = pasteBox.value.trim();
        if (!text) {
          setStatus('Paste text first, then press Read pasted text.', true);
          pasteBox.focus();
          return;
        }
        vscodeApi.postMessage({ type: 'readPasted', text });
      });
      document.getElementById('readClipboardBtn').addEventListener('click', () => {
        vscodeApi.postMessage({ type: 'runCommand', command: 'vartermCursor.readClipboardAloud' });
      });
      document.getElementById('readEditorBtn').addEventListener('click', () => {
        vscodeApi.postMessage({ type: 'runCommand', command: 'vartermCursor.readEditorAloud' });
      });

      window.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data.type === 'loading') {
          tracks = [];
          revoke();
          player.removeAttribute('src');
          setReadyControls(false);
          labelMeta.textContent = data.label || 'Generating';
          partMeta.textContent = '';
          timeMeta.textContent = '0:00 / 0:00';
          setStatus('Preparing audio…');
          return;
        }
        if (data.type === 'needText') {
          setStatus('Paste text below, then press Read pasted text.');
          pasteBox.focus();
          return;
        }
        if (data.type === 'error') {
          setReadyControls(false);
          labelMeta.textContent = data.label || 'Error';
          setStatus(data.message || 'Audio generation failed.', true);
          return;
        }
        if (data.type === 'ready' && Array.isArray(data.tracks) && data.tracks.length) {
          tracks = data.tracks;
          labelMeta.textContent = data.label || 'Audio ready';
          loadTrack(0, true);
        }
      });
    </script>
  </body>
</html>`;
}
