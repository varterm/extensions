import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createTtsHttpClient } from '@varterm/tts-client';
import { sliceMp3FromMs } from './mp3';
import {
  claimPlayback,
  ownedByAnotherWindow,
  readPlaybackOwner,
  releasePlayback,
  watchPlaybackLock,
  type PlaybackOwner,
} from './playback-lock';
import { PLAYER_VIEW_ID, VartermPlayerViewProvider } from './player-view';
import {
  AUTO_READ_KEY,
  getAutoReadEnabled,
  installVartermAgentHook,
  loadAutoReadEnabled,
  persistAutoReadEnabled,
  readLastAgentText,
  stripForSpeech,
  watchAgentDropFile,
} from './auto-read';

const SECRET_TOKEN_KEY = 'vartermCursor.apiToken';
const SECRET_ELEVENLABS_KEY = 'vartermCursor.elevenLabsApiKey';
const BASE_URL_KEY = 'vartermCursor.baseUrl';
const SESSION_KEY = 'vartermCursor.latestSession';
const VOICE_ID_KEY = 'vartermCursor.voiceId';
const VOICE_NAME_KEY = 'vartermCursor.voiceName';
const VOICE_PROVIDER_KEY = 'vartermCursor.voiceProvider';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_FILES = 20;
const DEFAULT_MAX_TOTAL_TEXT_CHARS = 1_000_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_REQUEST_RETRIES = 2;
const SHORTCUTS_TIP_KEY = 'vartermCursor.shortcutsTipShown';
const AUTO_READ_TIP_KEY = 'vartermCursor.autoReadTipShown';
const RATE_KEY = 'vartermCursor.readAloudRate';
const SPEED_CHOICES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const SHIPPED_SHORTCUTS = {
  readClipboardAloud: { mac: 'cmd+shift+alt+l', win: 'ctrl+shift+y' },
  readEditorAloud: { mac: 'cmd+shift+alt+r', win: 'ctrl+shift+r' },
} as const;

type IngestResult = {
  sessionId: string;
  expiresInMs: number;
  documentCount: number;
  chunkCount: number;
  totalChars: number;
  truncated: boolean;
  documents: Array<{
    path: string;
    characters?: number;
    chunks?: number;
    skipped?: boolean;
    reason?: string;
  }>;
};

type AskSource = {
  path: string;
  chunk: number;
  score: number;
  startChar?: number;
  endChar?: number;
};

type ExtensionSettings = {
  requestTimeoutMs: number;
  requestRetries: number;
  maxTotalTextChars: number;
  chunkSize: number;
  chunkOverlap: number;
  askMaxChunks: number;
  askMaxContextChars: number;
  autoReadAnswersAloud: boolean;
  autoReadAgentOutput: boolean;
  readAloudVoice: string;
  readAloudRate: number;
  readAloudProvider: 'edge' | 'premium';
  maxCachedAudioFiles: number;
  maxCachedAudioAgeHours: number;
  showPlayingIndicator: boolean;
  resumeRewindMs: number;
};

type AudioTrack = { title: string; base64: string };

let isGeneratingAudio = false;
let generationCts: vscode.CancellationTokenSource | undefined;
let readGeneration = 0;
let latestPlayback: { tracks: AudioTrack[]; label: string } | undefined;
let lastAgentPlayback: { tracks: AudioTrack[]; label: string } | undefined;
let latestSpoken: { text: string; label: string; rate: number; voiceId: string } | undefined;
let playerProvider: VartermPlayerViewProvider | undefined;
let playbackProcess: ChildProcess | undefined;
let previewProcess: ChildProcess | undefined;
let previewGeneration = 0;
let previewCts: vscode.CancellationTokenSource | undefined;
const livePlayers = new Set<ChildProcess>();
const stoppedPlayers = new WeakSet<ChildProcess>();
let playbackState: 'idle' | 'generating' | 'playing' | 'paused' = 'idle';
let playbackFiles: string[] = [];
let playbackIndex = 0;
let playGeneration = 0;
// Where the running afplay started inside the current part, and when it was
// spawned. Together they give the play position, which pause has to record
// because afplay is killed rather than suspended.
let chunkOffsetMs = 0;
let chunkStartedAt = 0;
let pausedOffsetMs: number | undefined;
let expectedTrackCount = 0;
let waitingForChunk: number | undefined;
let playResolve: (() => void) | undefined;
let playReject: ((error: Error) => void) | undefined;
let statusBar: vscode.StatusBarItem | undefined;
let stopStatusBar: vscode.StatusBarItem | undefined;
let jumpBackBar: vscode.StatusBarItem | undefined;
let jumpForwardBar: vscode.StatusBarItem | undefined;
let replayBar: vscode.StatusBarItem | undefined;
let autoReadStatusBar: vscode.StatusBarItem | undefined;
let listenBar: vscode.StatusBarItem | undefined;
let queueBar: vscode.StatusBarItem | undefined;
let speedBar: vscode.StatusBarItem | undefined;
let playingIndicator: vscode.StatusBarItem | undefined;
let indicatorTimer: ReturnType<typeof setInterval> | undefined;
let indicatorFrame = 0;
let autoReadWatcher: { dispose: () => void } | undefined;
let playbackLockWatcher: { dispose: () => void } | undefined;
// Another Cursor window that currently holds playback, so this window can show
// what is going on instead of looking idle.
let otherWindow: PlaybackOwner | undefined;
/** User Play steals the speaker. Auto-read must not. */
let playbackClaimSteals = true;
let outputChannel: vscode.OutputChannel | undefined;
let extensionContext: vscode.ExtensionContext | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Varterm TTS');
  }
  return outputChannel;
}

function logInfo(message: string): void {
  getOutputChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
}

// The indicator is the logo mark itself, shipped as a contributed icon font
// (assets/varterm-icons.ttf) with one glyph per animation frame. No text glyph
// can draw it: braille varies in height but is dotted, and the block elements
// are solid but fill a whole cell as thick slabs. The font draws five solid
// capsules that grow out from a shared centre line, same as the logo.
// Frame count must match FRAME_COUNT in scripts/build-icon-font.mjs.
const INDICATOR_FRAME_COUNT = 8;
const INDICATOR_FRAMES = Array.from(
  { length: INDICATOR_FRAME_COUNT },
  (_unused, frame) => `$(varterm-bars-${frame})`,
);
const INDICATOR_PAUSED = '$(varterm-bars-idle)';
const INDICATOR_INTERVAL_MS = 120;

function playbackPositionLabel(): string {
  const total = expectedTrackCount || playbackFiles.length || latestPlayback?.tracks.length || 0;
  return total ? ` — part ${Math.min(playbackIndex + 1, total)} of ${total}` : '';
}

function stopIndicatorAnimation(): void {
  if (indicatorTimer) {
    clearInterval(indicatorTimer);
    indicatorTimer = undefined;
  }
}

function refreshPlayingIndicator(): void {
  if (!playingIndicator) {
    return;
  }

  if (!getSettings().showPlayingIndicator) {
    stopIndicatorAnimation();
    playingIndicator.hide();
    return;
  }

  if (playbackState === 'playing') {
    playingIndicator.text = INDICATOR_FRAMES[indicatorFrame];
    playingIndicator.tooltip = `Varterm is playing in this window${playbackPositionLabel()}`;
    playingIndicator.color = new vscode.ThemeColor('charts.green');
    if (!indicatorTimer) {
      indicatorTimer = setInterval(() => {
        indicatorFrame = (indicatorFrame + 1) % INDICATOR_FRAMES.length;
        if (playingIndicator) {
          playingIndicator.text = INDICATOR_FRAMES[indicatorFrame];
        }
      }, INDICATOR_INTERVAL_MS);
    }
    playingIndicator.show();
    return;
  }

  stopIndicatorAnimation();

  if (playbackState === 'paused') {
    playingIndicator.text = INDICATOR_PAUSED;
    playingIndicator.tooltip = `Varterm is paused in this window${playbackPositionLabel()}`;
    playingIndicator.color = new vscode.ThemeColor('descriptionForeground');
    playingIndicator.show();
    return;
  }

  // Nothing playing here, but another window has the audio. Show the mark
  // static and dimmed so this window does not look idle while Varterm talks.
  if (otherWindow) {
    playingIndicator.text = INDICATOR_PAUSED;
    playingIndicator.tooltip =
      otherWindow.state === 'paused'
        ? 'Varterm is paused in another Cursor window. Press Play to move it here.'
        : 'Varterm is playing in another Cursor window. Press Play to move it here.';
    playingIndicator.color = new vscode.ThemeColor('descriptionForeground');
    playingIndicator.show();
    return;
  }

  playingIndicator.hide();
}

function refreshTransport(): void {
  const active = playbackState === 'playing' || playbackState === 'paused';
  const hasTracks = Boolean(latestPlayback?.tracks.length);

  if (statusBar) {
    if (playbackState === 'playing') {
      statusBar.text = '$(debug-pause)';
      statusBar.tooltip = 'Pause';
    } else if (playbackState === 'paused') {
      statusBar.text = '$(play)';
      statusBar.tooltip = 'Resume';
    } else if (playbackState === 'generating') {
      statusBar.text = '$(loading~spin)';
      statusBar.tooltip = 'Cancel';
    } else if (otherWindow) {
      statusBar.text = '$(play)';
      statusBar.tooltip = 'Play here — stops the Cursor window that is playing now';
    } else {
      statusBar.text = '$(play)';
      statusBar.tooltip = editorHasSelection()
        ? 'Play the highlighted text'
        : 'Play the highlight, last listen, or clipboard';
    }
    statusBar.command = 'vartermCursor.statusBarAction';
    statusBar.show();
  }

  if (stopStatusBar) {
    stopStatusBar.text = '$(debug-stop)';
    stopStatusBar.tooltip = 'Stop';
    if (active) {
      stopStatusBar.show();
    } else {
      stopStatusBar.hide();
    }
  }

  if (jumpBackBar && jumpForwardBar) {
    jumpBackBar.text = '$(chevron-left)';
    const total = expectedTrackCount || playbackFiles.length || latestPlayback?.tracks.length || 0;
    const position = total ? `${Math.min(playbackIndex + 1, total)}/${total}` : '';
    jumpBackBar.tooltip = position
      ? `Jump back ${position}`
      : 'Jump back (press again to skip further)';
    jumpForwardBar.text = '$(chevron-right)';
    jumpForwardBar.tooltip = position
      ? `Jump forward ${position}`
      : 'Jump forward (press again to skip further)';
    if (active || hasTracks) {
      jumpBackBar.show();
      jumpForwardBar.show();
    } else {
      jumpBackBar.hide();
      jumpForwardBar.hide();
    }
  }

  if (replayBar) {
    replayBar.text = '$(debug-restart)';
    replayBar.tooltip = 'Replay from the start';
    if (hasTracks) {
      replayBar.show();
    } else {
      replayBar.hide();
    }
  }

  refreshPlayingIndicator();
  refreshListenBar();
  refreshQueueBar();
}

let rememberedSelection = '';

function currentEditorSelection(): string {
  const editor = vscode.window.activeTextEditor;
  const fromActive = editor?.document.getText(editor.selection).trim() || '';
  if (fromActive) {
    return fromActive;
  }
  for (const visible of vscode.window.visibleTextEditors) {
    const text = visible.document.getText(visible.selection).trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function rememberEditorSelection(): void {
  const selected = currentEditorSelection();
  if (selected) {
    rememberedSelection = selected;
  }
}

function selectionToRead(): string {
  return currentEditorSelection() || rememberedSelection;
}

function tabResourceUri(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  const input = tab?.input;
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  if ('uri' in input && input.uri instanceof vscode.Uri) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputTextDiff) {
    return input.modified;
  }
  return undefined;
}

function isNonTextEditorTab(tab: vscode.Tab | undefined): boolean {
  if (!tab) {
    return false;
  }
  if (
    tab.input instanceof vscode.TabInputCustom ||
    tab.input instanceof vscode.TabInputWebview ||
    tab.input instanceof vscode.TabInputNotebook
  ) {
    return true;
  }
  return /plan/i.test(tab.label);
}

function isMarkdownUri(uri: vscode.Uri | undefined): boolean {
  if (!uri) {
    return false;
  }
  return /\.(md|plan\.md|markdown)$/i.test(uri.path);
}

function tabLooksLikePlan(tab: vscode.Tab | undefined): boolean {
  if (!tab) {
    return false;
  }
  if (/plan/i.test(tab.label)) {
    return true;
  }
  const input = tab.input;
  if (input instanceof vscode.TabInputCustom) {
    if (/plan/i.test(input.viewType) || isMarkdownUri(input.uri)) {
      return true;
    }
  }
  if (input instanceof vscode.TabInputWebview && /plan/i.test(input.viewType)) {
    return true;
  }
  const uri = tabResourceUri(tab);
  if (!uri) {
    return false;
  }
  return (
    isMarkdownUri(uri) &&
    (/\.plan\.md$/i.test(uri.path) ||
      /\/\.?cursor\/.*plan/i.test(uri.path) ||
      /plan/i.test(uri.scheme) ||
      input instanceof vscode.TabInputCustom)
  );
}

function editorHasSelection(): boolean {
  return Boolean(selectionToRead()) || isNonTextEditorTab(vscode.window.tabGroups.activeTabGroup.activeTab);
}

function stripPlanChrome(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let clipboardSnapshot = '';

async function snapshotClipboard(): Promise<void> {
  try {
    clipboardSnapshot = await vscode.env.clipboard.readText();
  } catch {
    clipboardSnapshot = '';
  }
}

async function freshClipboardText(): Promise<string> {
  const text = await vscode.env.clipboard.readText();
  if (text && text !== clipboardSnapshot) {
    clipboardSnapshot = text;
    return text.trim();
  }
  return '';
}

function currentEditorLine(): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.selection.isEmpty) {
    return '';
  }
  return editor.document.lineAt(editor.selection.active.line).text.trim();
}

async function copyFocusedHighlight(): Promise<string> {
  const before = await vscode.env.clipboard.readText();
  const sentinel = `\u200bvarterm-sel-${Date.now()}`;
  const ignoreLine = currentEditorLine();
  await vscode.env.clipboard.writeText(sentinel);

  const attemptCopy = async (): Promise<string> => {
    try {
      await vscode.commands.executeCommand('copy');
    } catch {
      return '';
    }
    await delay(60);
    const after = await vscode.env.clipboard.readText();
    if (!after || after === sentinel) {
      return '';
    }
    if (ignoreLine && after.trim() === ignoreLine) {
      return '';
    }
    return after.trim();
  };

  let copied = await attemptCopy();
  if (!copied) {
    for (const command of ['workbench.action.focusAuxiliaryBar', 'workbench.action.focusPanel']) {
      try {
        await vscode.commands.executeCommand(command);
      } catch {
        // Command may not exist in this host.
      }
    }
    await delay(60);
    copied = await attemptCopy();
  }

  try {
    await vscode.env.clipboard.writeText(before);
    clipboardSnapshot = before;
  } catch {
    // Keep whatever is on the clipboard if restore fails.
  }
  return copied;
}

async function readUriText(uri: vscode.Uri): Promise<string> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    return stripPlanChrome(doc.getText());
  } catch {
    try {
      return stripPlanChrome(await readFile(uri.fsPath, 'utf8'));
    } catch {
      return '';
    }
  }
}

function normalizePlanKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.plan\.md$/i, '')
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/g, '');
}

async function collectPlanDirs(): Promise<string[]> {
  const dirs = [path.join(os.homedir(), '.cursor', 'plans')];
  for (const folder of vscode.workspace.workspaceFolders || []) {
    dirs.push(path.join(folder.uri.fsPath, '.cursor', 'plans'));
  }
  return dirs;
}

async function textFromPlanDisk(tab: vscode.Tab | undefined): Promise<string> {
  const labelKey = tab?.label ? normalizePlanKey(tab.label) : '';
  const uriKey = normalizePlanKey(tabResourceUri(tab)?.path || '');
  let newest = { mtime: 0, text: '' };

  for (const dir of await collectPlanDirs()) {
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/\.(md|plan\.md)$/i.test(name)) {
        continue;
      }
      const full = path.join(dir, name);
      const nameKey = normalizePlanKey(name);
      const matches =
        (labelKey && (nameKey.includes(labelKey) || labelKey.includes(nameKey))) ||
        (uriKey && (nameKey.includes(uriKey) || uriKey.includes(nameKey)));
      if (!matches && (labelKey || uriKey)) {
        continue;
      }
      try {
        const info = await stat(full);
        const text = stripPlanChrome(await readFile(full, 'utf8'));
        if (!text) {
          continue;
        }
        if (!labelKey && !uriKey) {
          if (info.mtimeMs > newest.mtime) {
            newest = { mtime: info.mtimeMs, text };
          }
          continue;
        }
        if (info.mtimeMs > newest.mtime) {
          newest = { mtime: info.mtimeMs, text };
        }
      } catch {
        // Skip unreadable plan files.
      }
    }
  }
  return newest.text;
}

async function textFromPlanTab(): Promise<string> {
  const tabs = [
    vscode.window.tabGroups.activeTabGroup.activeTab,
    ...vscode.window.tabGroups.all.map((group) => group.activeTab),
  ].filter((tab): tab is vscode.Tab => {
    if (!tab) {
      return false;
    }
    return (
      tabLooksLikePlan(tab) ||
      isNonTextEditorTab(tab) ||
      isMarkdownUri(tabResourceUri(tab))
    );
  });
  if (!tabs.length) {
    return '';
  }
  for (const tab of tabs) {
    const uri = tabResourceUri(tab);
    if (uri) {
      const fromUri = await readUriText(uri);
      if (fromUri) {
        return fromUri;
      }
    }
    const fromDisk = await textFromPlanDisk(tab);
    if (fromDisk) {
      return fromDisk;
    }
  }
  return '';
}

async function resolveHighlightedText(): Promise<{ text: string; label: string } | undefined> {
  const selected = selectionToRead();
  if (selected) {
    return { text: selected, label: 'selection' };
  }
  const copied = await copyFocusedHighlight();
  if (copied) {
    return { text: copied, label: 'selection' };
  }
  const plan = await textFromPlanTab();
  if (plan) {
    return { text: plan, label: 'plan' };
  }
  return undefined;
}

function formatSpeed(rate: number): string {
  const rounded = Math.round(rate * 100) / 100;
  return `${rounded}×`;
}

function getReadAloudRate(context: vscode.ExtensionContext = extensionContext as vscode.ExtensionContext): number {
  const stored = context?.globalState.get<number>(RATE_KEY);
  if (typeof stored === 'number' && stored >= 0.5 && stored <= 2) {
    return stored;
  }
  return getSettings().readAloudRate;
}

function refreshSpeedBar(): void {
  if (!speedBar) {
    return;
  }
  const rate = getReadAloudRate();
  speedBar.text = `$(dashboard) ${formatSpeed(rate)}`;
  speedBar.tooltip = `Reading speed ${formatSpeed(rate)}. Click for speed, voice, and settings.`;
  speedBar.command = 'vartermCursor.openPlaybackMenu';
  speedBar.show();
}

function spokenSettingsStale(context: vscode.ExtensionContext): boolean {
  if (!latestSpoken) {
    return false;
  }
  return (
    latestSpoken.rate !== getReadAloudRate(context) || latestSpoken.voiceId !== currentVoiceId(context)
  );
}

async function replayWithCurrentSettings(context: vscode.ExtensionContext): Promise<boolean> {
  if (latestSpoken?.text && spokenSettingsStale(context)) {
    await readTextAloud(context, latestSpoken.text, latestSpoken.label, { replace: true });
    return true;
  }
  return false;
}

async function setReadAloudRate(
  context: vscode.ExtensionContext,
  rate: number
): Promise<void> {
  const next = Math.min(2, Math.max(0.5, Math.round(rate * 100) / 100));
  await context.globalState.update(RATE_KEY, next);
  await tryUpdateUserSetting('readAloudRate', next);
  refreshSpeedBar();
  logInfo(`Read speed set to ${formatSpeed(next)}`);

  const shouldReread =
    Boolean(latestSpoken?.text) &&
    (playbackState === 'playing' || playbackState === 'paused' || playbackState === 'generating');
  if (shouldReread && latestSpoken) {
    await readTextAloud(context, latestSpoken.text, latestSpoken.label, { replace: true });
  }
}

async function openPlaybackMenu(context: vscode.ExtensionContext): Promise<void> {
  const current = getReadAloudRate(context);
  const voiceName = context.globalState.get<string>(VOICE_NAME_KEY) || getSettings().readAloudVoice;
  type MenuItem = vscode.QuickPickItem & {
    action?: 'speed' | 'voice' | 'settings';
    rate?: number;
  };
  const items: MenuItem[] = [
    ...SPEED_CHOICES.map((rate) => ({
      label: rate === current ? `$(check) ${formatSpeed(rate)}` : formatSpeed(rate),
      description: rate === current ? 'Current speed' : undefined,
      action: 'speed' as const,
      rate,
    })),
    { kind: vscode.QuickPickItemKind.Separator, label: '' },
    { label: '$(person) Voice…', description: voiceName, action: 'voice' },
    { label: '$(gear) Open settings', action: 'settings' },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Varterm',
    placeHolder: 'Reading speed',
  });
  if (!picked?.action) {
    return;
  }
  if (picked.action === 'voice') {
    await selectReadAloudVoice(context);
    return;
  }
  if (picked.action === 'settings') {
    await openSettings();
    return;
  }
  if (picked.action === 'speed' && typeof picked.rate === 'number' && picked.rate !== current) {
    await setReadAloudRate(context, picked.rate);
  }
}

function refreshListenBar(): void {
  if (!listenBar) {
    return;
  }
  rememberEditorSelection();
  const selected = editorHasSelection();
  const planTab = tabLooksLikePlan(vscode.window.tabGroups.activeTabGroup.activeTab);
  listenBar.text = selected || planTab ? '$(selection)' : '$(clippy)';
  listenBar.tooltip = planTab
    ? 'Read the highlighted plan text (or the whole plan if the highlight is in the plan view)'
    : selected
      ? 'Read the highlighted selection (nothing is copied)'
      : 'Highlight text to read it, or click to read the clipboard';
  listenBar.command = 'vartermCursor.readSelectionOrClipboard';
  listenBar.show();
}

type QueuedListen = {
  id: string;
  text: string;
  label: string;
  tracks?: AudioTrack[];
  index?: number;
  offsetMs?: number;
};

const listenQueue: QueuedListen[] = [];
const listenHistory: QueuedListen[] = [];
let advancingQueue = false;

function isPlaybackBusy(): boolean {
  return (
    playbackState === 'playing' ||
    playbackState === 'paused' ||
    playbackState === 'generating' ||
    isGeneratingAudio ||
    Boolean(playbackProcess)
  );
}

function anotherWindowOwnsPlayback(): boolean {
  return ownedByAnotherWindow(readPlaybackOwner());
}

function listenPreview(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 72 ? `${compact.slice(0, 71)}…` : compact;
}

function currentListenSnapshot(): QueuedListen | undefined {
  const text = latestSpoken?.text || '';
  const label = latestSpoken?.label || latestPlayback?.label || 'audio';
  if (!text && !latestPlayback?.tracks.length) {
    return undefined;
  }
  const offset =
    playbackState === 'paused'
      ? pausedOffsetMs ?? 0
      : playbackState === 'playing'
        ? Math.max(0, currentChunkPositionMs() - getSettings().resumeRewindMs)
        : 0;
  return {
    id: `now-${Date.now()}`,
    text,
    label,
    tracks: latestPlayback?.tracks.slice(),
    index: playbackIndex,
    offsetMs: offset,
  };
}

function enqueueListen(item: Omit<QueuedListen, 'id'>): boolean {
  const text = item.text.trim();
  if (!text) {
    return false;
  }
  if (latestSpoken?.text === text || listenQueue.some((queued) => queued.text === text)) {
    return false;
  }
  listenQueue.push({ ...item, id: `q-${Date.now()}-${listenQueue.length}`, text });
  refreshQueueBar();
  return true;
}

function pushListenHistory(item: QueuedListen): void {
  if (!item.text && !item.tracks?.length) {
    return;
  }
  const last = listenHistory[listenHistory.length - 1];
  if (last?.text && last.text === item.text) {
    listenHistory[listenHistory.length - 1] = item;
    return;
  }
  listenHistory.push(item);
  if (listenHistory.length > 8) {
    listenHistory.shift();
  }
}

function refreshQueueBar(): void {
  if (!queueBar) {
    return;
  }
  const waiting = listenQueue.length;
  const previous = listenHistory.length;
  if (!waiting && !previous && !isPlaybackBusy()) {
    queueBar.hide();
    return;
  }
  queueBar.text = waiting ? `$(list-ordered) ${waiting}` : '$(list-flat)';
  queueBar.tooltip = [
    waiting ? `${waiting} waiting` : 'Nothing waiting',
    previous ? `${previous} you can go back to` : '',
    'Click to open the queue',
  ]
    .filter(Boolean)
    .join(' · ');
  queueBar.command = 'vartermCursor.openListenQueue';
  queueBar.show();
}

async function maybeAdvanceQueue(): Promise<void> {
  if (
    advancingQueue ||
    isPlaybackBusy() ||
    anotherWindowOwnsPlayback() ||
    !listenQueue.length ||
    !extensionContext
  ) {
    refreshQueueBar();
    return;
  }
  advancingQueue = true;
  const finished = currentListenSnapshot();
  if (finished) {
    pushListenHistory({ ...finished, offsetMs: 0, index: 0 });
  }
  const next = listenQueue.shift();
  refreshQueueBar();
  if (!next) {
    advancingQueue = false;
    return;
  }
  try {
    await startQueuedListen(extensionContext, next);
  } catch (error) {
    if (!isReadCancelled(error)) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Varterm queue: ${message}`);
    }
  } finally {
    advancingQueue = false;
    if (!isPlaybackBusy() && listenQueue.length) {
      void maybeAdvanceQueue();
    }
  }
}

async function startQueuedListen(
  context: vscode.ExtensionContext,
  item: QueuedListen
): Promise<void> {
  if (item.tracks?.length) {
    latestSpoken = item.text
      ? {
          text: item.text,
          label: item.label,
          rate: getReadAloudRate(context),
          voiceId: currentVoiceId(context),
        }
      : latestSpoken;
    rememberPlayback(item.tracks, item.label);
    await playTracksInCursor(context, item.tracks, item.index ?? 0, item.offsetMs ?? 0);
    return;
  }
  await readTextAloud(context, item.text, item.label, { replace: true, fromQueue: true });
}

async function openListenQueue(context: vscode.ExtensionContext): Promise<void> {
  type QueuePick = vscode.QuickPickItem & {
    action?: 'queued' | 'history' | 'clear';
    item?: QueuedListen;
  };
  const items: QueuePick[] = [];
  const current = isPlaybackBusy() ? currentListenSnapshot() : undefined;
  if (current) {
    items.push({
      label: `$(play) Now: ${current.label}`,
      description: listenPreview(current.text),
      detail: 'Playing or paused',
    });
  }
  for (const queued of listenQueue) {
    items.push({
      label: `$(clock) Up next: ${queued.label}`,
      description: listenPreview(queued.text),
      action: 'queued',
      item: queued,
    });
  }
  for (let i = listenHistory.length - 1; i >= 0; i -= 1) {
    const previous = listenHistory[i];
    items.push({
      label: `$(history) Previous: ${previous.label}`,
      description: listenPreview(previous.text),
      action: 'history',
      item: previous,
    });
  }
  if (listenQueue.length) {
    items.push({ label: '$(discard) Clear waiting items', action: 'clear' });
  }
  if (!items.length) {
    vscode.window.showInformationMessage('Nothing in the listen queue yet.');
    return;
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Varterm queue',
    placeHolder: 'Play a waiting or previous listen',
  });
  if (!picked?.action) {
    return;
  }
  if (picked.action === 'clear') {
    listenQueue.length = 0;
    refreshQueueBar();
    return;
  }
  if (!picked.item) {
    return;
  }
  if (picked.action === 'queued') {
    const index = listenQueue.findIndex((queued) => queued.id === picked.item?.id);
    if (index >= 0) {
      listenQueue.splice(index, 1);
    }
  }
  if (isPlaybackBusy()) {
    const snap = currentListenSnapshot();
    if (snap) {
      if (picked.action === 'history') {
        listenQueue.unshift(snap);
      } else {
        pushListenHistory(snap);
      }
    }
  }
  await startQueuedListen(context, picked.item);
}

// Advertise to the other Cursor windows whether this one holds the audio, so
// their Play button can hand over instead of starting a second, overlapping
// read of the same reply.
function publishPlaybackOwnership(): void {
  if (playbackState === 'playing' || playbackState === 'paused') {
    otherWindow = undefined;
    claimPlayback(playbackState, latestPlayback?.label || 'audio', playbackClaimSteals);
    return;
  }
  releasePlayback();
}

function handlePlaybackLockChange(): void {
  const owner = readPlaybackOwner();
  const foreign = ownedByAnotherWindow(owner) ? owner : undefined;
  const changed = foreign?.pid !== otherWindow?.pid || foreign?.state !== otherWindow?.state;
  otherWindow = foreign;

  // Only yield when the other window pressed Play (steal). Auto-read claims
  // must not silence a window that is already speaking.
  const shouldYield = Boolean(foreign && foreign.steal !== false);
  if (foreign && shouldYield && (playbackState === 'playing' || playbackState === 'paused')) {
    const snap = currentListenSnapshot();
    if (snap) {
      pushListenHistory(snap);
    }
    logInfo(`Playback moved to another Cursor window (pid ${foreign.pid}); saved so you can resume`);
    stopHostPlayback();
    setIdleStatus();
    refreshQueueBar();
    return;
  }

  if (changed) {
    refreshTransport();
  }
}

function setPlaybackStatus(_text: string, state: typeof playbackState = playbackState): void {
  playbackState = state;
  publishPlaybackOwnership();
  refreshTransport();
}

function setIdleStatus(): void {
  setPlaybackStatus('$(play)', 'idle');
}

function setAutoReadStatus(enabled: boolean): void {
  if (!autoReadStatusBar) {
    return;
  }
  autoReadStatusBar.text = enabled ? '$(unmute) Auto-read on' : '$(mute) Auto-read off';
  autoReadStatusBar.tooltip = enabled
    ? 'On in this window: when an assistant reply finishes, Varterm reads it. Click to turn off.'
    : 'Off in this window. Click to auto-read assistant replies here when they finish.';
  autoReadStatusBar.show();
}

async function tryUpdateUserSetting(key: string, value: unknown): Promise<void> {
  try {
    await vscode.workspace
      .getConfiguration('vartermCursor')
      .update(key, value, vscode.ConfigurationTarget.Global);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logInfo(`Could not write user setting ${key}: ${message}`);
  }
}

async function setAutoReadEnabled(
  context: vscode.ExtensionContext,
  enabled: boolean,
  _options?: { persistSettings?: boolean }
): Promise<void> {
  await persistAutoReadEnabled(context, enabled);
  setAutoReadStatus(enabled);

  autoReadWatcher?.dispose();
  autoReadWatcher = undefined;

  if (!enabled) {
    logInfo('Auto-read off');
    return;
  }

  try {
    await installVartermAgentHook(context.extensionPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logInfo(`Hook install skipped: ${message}`);
  }
  autoReadWatcher = watchAgentDropFile((text, markHeard) => {
    return readTextAloud(context, text, 'agent reply', { replace: true, onStarted: markHeard }).catch(
      (error) => {
        if (isReadCancelled(error)) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Varterm auto-read: ${message}`);
        throw error;
      }
    );
  }, logInfo);
  logInfo('Auto-read on');
}

async function toggleAutoRead(context: vscode.ExtensionContext): Promise<void> {
  const next = !getAutoReadEnabled(context);
  await setAutoReadEnabled(context, next);
  vscode.window.showInformationMessage(
    next ? 'Auto-read on in this window. Finished replies will play here.' : 'Auto-read off in this window.'
  );
}

function forceKillChild(child: ChildProcess): void {
  stoppedPlayers.add(child);
  livePlayers.delete(child);
  try {
    child.kill('SIGCONT');
  } catch {
    // Not paused.
  }
  try {
    if (child.pid) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    // Already exited.
  }
}

function stopPreviewPlayback(): void {
  previewGeneration += 1;
  previewCts?.cancel();
  previewCts?.dispose();
  previewCts = undefined;
  if (previewProcess) {
    forceKillChild(previewProcess);
    previewProcess = undefined;
  }
}

function killPlaybackProcess(): void {
  const child = playbackProcess;
  playbackProcess = undefined;
  if (child) {
    forceKillChild(child);
  }
  for (const extra of [...livePlayers]) {
    forceKillChild(extra);
  }
}

function killPlaybackProcessAsync(): Promise<void> {
  const children = [
    ...(playbackProcess ? [playbackProcess] : []),
    ...livePlayers,
  ].filter((child, index, all) => all.indexOf(child) === index);
  playbackProcess = undefined;
  if (!children.length) {
    return Promise.resolve();
  }
  return Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode) {
            forceKillChild(child);
            resolve();
            return;
          }
          const finish = () => {
            child.off('close', finish);
            resolve();
          };
          child.once('close', finish);
          forceKillChild(child);
          setTimeout(finish, 250);
        })
    )
  ).then(() => undefined);
}

function stopHostPlayback(options?: { keepPreview?: boolean }): void {
  if (!options?.keepPreview) {
    stopPreviewPlayback();
  }
  playGeneration += 1;
  waitingForChunk = undefined;
  pausedOffsetMs = undefined;
  chunkStartedAt = 0;
  chunkOffsetMs = 0;
  killPlaybackProcess();
  playResolve?.();
  playResolve = undefined;
  playReject = undefined;
}

function currentChunkPositionMs(): number {
  if (!chunkStartedAt) {
    return 0;
  }
  return chunkOffsetMs + (Date.now() - chunkStartedAt);
}

// afplay cannot be paused. It hands the clip straight to CoreAudio, so SIGSTOP
// freezes the process while the sound plays on, and the audio that elapses
// while suspended is simply lost. Pause therefore kills the player exactly like
// stop does, and remembers the position so resume can pick it back up.
function pauseHostPlayback(): boolean {
  if (!playbackProcess || playbackState !== 'playing') {
    return false;
  }
  pausedOffsetMs = Math.max(0, currentChunkPositionMs() - getSettings().resumeRewindMs);
  killPlaybackProcess();
  chunkStartedAt = 0;
  logInfo(`Paused at ${(pausedOffsetMs / 1000).toFixed(1)}s of part ${playbackIndex + 1}`);
  setPlaybackStatus('$(play)', 'paused');
  return true;
}

function resumeHostPlayback(): boolean {
  if (playbackState !== 'paused' || !playbackFiles.length) {
    return false;
  }
  const offsetMs = pausedOffsetMs ?? 0;
  setPlaybackStatus('$(debug-pause)', 'playing');
  startChunk(playbackIndex, playGeneration, offsetMs);
  return true;
}

async function playTracksInCursor(
  context: vscode.ExtensionContext,
  tracks: AudioTrack[],
  startIndex = 0,
  startOffsetMs = 0
): Promise<void> {
  stopHostPlayback();
  expectedTrackCount = tracks.length;
  waitingForChunk = undefined;
  const outputDir = audioCacheDir(context);
  await vscode.workspace.fs.createDirectory(outputDir);

  const files: string[] = [];
  const stamp = Date.now();
  for (let i = 0; i < tracks.length; i += 1) {
    const uri = vscode.Uri.joinPath(outputDir, `varterm-play-${stamp}-${i + 1}.mp3`);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(tracks[i].base64, 'base64'));
    files.push(uri.fsPath);
  }

  if (process.platform !== 'darwin') {
    throw new Error('Background playback currently uses macOS afplay.');
  }

  for (const filePath of files) {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    logInfo(`Audio file ${filePath} size=${stat.size}`);
    if (stat.size < 100) {
      throw new Error('Generated audio file was empty. Try again.');
    }
  }

  setPlaybackStatus('$(debug-pause)', 'playing');
  logInfo(`Playing ${files.length} track(s) with /usr/bin/afplay`);

  try {
    await playFilesWithAfplay(files, startIndex, startOffsetMs);
  } finally {
    if (
      (playbackState === 'playing' || playbackState === 'paused') &&
      playbackFiles === files
    ) {
      setIdleStatus();
      void maybeAdvanceQueue();
    }
    void pruneAudioCache(context);
  }
}

function finishPlaylist(): void {
  playbackProcess = undefined;
  waitingForChunk = undefined;
  playResolve?.();
  playResolve = undefined;
  playReject = undefined;
  if (playbackState === 'playing' || playbackState === 'paused') {
    setIdleStatus();
  }
}

// A copy of `filePath` with everything before `offsetMs` dropped, so afplay can
// start part-way in without a seek flag. Falls back to the untrimmed file, and
// therefore to replaying the part, if the MP3 cannot be cut.
function trimmedResumeFile(filePath: string, offsetMs: number): { path: string; offsetMs: number } {
  try {
    const data = readFileSync(filePath);
    const remainder = sliceMp3FromMs(data, offsetMs);
    if (!remainder.length || remainder.length === data.length) {
      return { path: filePath, offsetMs: 0 };
    }
    const path = `${filePath.replace(/\.mp3$/, '')}-resume.mp3`;
    writeFileSync(path, remainder);
    return { path, offsetMs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logInfo(`Could not trim for resume, replaying the part instead: ${message}`);
    return { path: filePath, offsetMs: 0 };
  }
}

function startChunk(index: number, generation: number, offsetMs = 0): void {
  if (generation !== playGeneration) {
    return;
  }
  killPlaybackProcess();
  if (index >= playbackFiles.length) {
    if (playbackFiles.length < expectedTrackCount) {
      waitingForChunk = index;
      logInfo(`Waiting for chunk ${index + 1}/${expectedTrackCount}`);
      return;
    }
    finishPlaylist();
    void maybeAdvanceQueue();
    return;
  }
  waitingForChunk = undefined;
  pausedOffsetMs = undefined;
  playbackIndex = Math.max(0, index);
  refreshTransport();
  const filePath = playbackFiles[playbackIndex];
  const resume =
    offsetMs > 0 ? trimmedResumeFile(filePath, offsetMs) : { path: filePath, offsetMs: 0 };
  chunkOffsetMs = resume.offsetMs;
  chunkStartedAt = Date.now();
  const from = resume.offsetMs ? ` from ${(resume.offsetMs / 1000).toFixed(1)}s` : '';
  logInfo(
    `Start chunk ${playbackIndex + 1}/${expectedTrackCount || playbackFiles.length}${from} ${resume.path}`
  );
  const child = spawn('/usr/bin/afplay', [resume.path], {
    stdio: 'ignore',
    env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
  });
  livePlayers.add(child);
  playbackProcess = child;

  child.on('error', (error) => {
    livePlayers.delete(child);
    if (generation !== playGeneration) {
      return;
    }
    if (playbackProcess === child) {
      playbackProcess = undefined;
    }
    playReject?.(error);
    playResolve = undefined;
    playReject = undefined;
  });

  child.on('close', (code, signal) => {
    livePlayers.delete(child);
    if (stoppedPlayers.has(child) || generation !== playGeneration || playbackProcess !== child) {
      return;
    }
    playbackProcess = undefined;
    if (code && code !== 0) {
      playReject?.(new Error(`afplay exited with code ${code}${signal ? ` (${signal})` : ''}`));
      playResolve = undefined;
      playReject = undefined;
      return;
    }
    startChunk(index + 1, generation);
  });
}

function playFilesWithAfplay(files: string[], startIndex = 0, startOffsetMs = 0): Promise<void> {
  playGeneration += 1;
  const generation = playGeneration;
  playbackFiles = files;
  return new Promise((resolve, reject) => {
    playResolve = resolve;
    playReject = reject;
    startChunk(Math.max(0, Math.min(startIndex, files.length - 1)), generation, startOffsetMs);
  });
}

async function jumpPlayback(delta: number): Promise<void> {
  if (!playbackFiles.length) {
    if (!latestPlayback?.tracks.length || !extensionContext) {
      return;
    }
    const last = latestPlayback.tracks.length - 1;
    const start = delta < 0 ? last : 0;
    try {
      await playTracksInCursor(extensionContext, latestPlayback.tracks, start);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Varterm: ${message}`);
    }
    return;
  }

  const from = playbackIndex;
  const readyLast = playbackFiles.length - 1;
  let next = from + delta;
  if (next < 0) {
    next = 0;
  }

  if (next > readyLast) {
    if (playbackFiles.length < expectedTrackCount) {
      const target = Math.min(next, expectedTrackCount - 1);
      logInfo(`Jump +${delta}: wait for chunk ${target + 1}/${expectedTrackCount}`);
      playGeneration += 1;
      const generation = playGeneration;
      playbackIndex = target;
      waitingForChunk = target;
      refreshTransport();
      await killPlaybackProcessAsync();
      if (generation !== playGeneration) {
        return;
      }
      setPlaybackStatus('$(debug-pause)', 'playing');
      refreshTransport();
      return;
    }
    logInfo(`Jump +${delta} ignored: already at ${from + 1}/${playbackFiles.length}`);
    return;
  }

  playGeneration += 1;
  const generation = playGeneration;
  playbackIndex = next;
  refreshTransport();
  logInfo(`Jump ${from + 1} -> ${next + 1} of ${expectedTrackCount || playbackFiles.length}`);
  await killPlaybackProcessAsync();
  if (generation !== playGeneration) {
    return;
  }
  setPlaybackStatus('$(debug-pause)', 'playing');
  startChunk(next, generation);
}

type VoiceOption = {
  id: string;
  label: string;
  description: string;
  provider: 'edge' | 'premium';
};

function getBaseUrl(context: vscode.ExtensionContext): string {
  return context.globalState.get<string>(BASE_URL_KEY) || 'https://www.varterm.com';
}

function getSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration('vartermCursor');
  const chunkSize = config.get<number>('chunkSize', 1800);
  const overlapRaw = config.get<number>('chunkOverlap', 250);
  const overlap = Math.min(Math.max(overlapRaw, 0), Math.floor(chunkSize / 2));

  return {
    requestTimeoutMs: config.get<number>('requestTimeoutMs', DEFAULT_REQUEST_TIMEOUT_MS),
    requestRetries: config.get<number>('requestRetries', DEFAULT_REQUEST_RETRIES),
    maxTotalTextChars: config.get<number>('maxTotalTextChars', DEFAULT_MAX_TOTAL_TEXT_CHARS),
    chunkSize,
    chunkOverlap: overlap,
    askMaxChunks: config.get<number>('askMaxChunks', 8),
    askMaxContextChars: config.get<number>('askMaxContextChars', 15000),
    autoReadAnswersAloud: config.get<boolean>('autoReadAnswersAloud', false),
    autoReadAgentOutput: config.get<boolean>('autoReadAgentOutput', false),
    readAloudVoice: config.get<string>('readAloudVoice', 'en-US-AriaNeural'),
    readAloudRate: config.get<number>('readAloudRate', 1),
    readAloudProvider: config.get<'edge' | 'premium'>('readAloudProvider', 'edge'),
    maxCachedAudioFiles: config.get<number>('maxCachedAudioFiles', 8),
    maxCachedAudioAgeHours: config.get<number>('maxCachedAudioAgeHours', 24),
    showPlayingIndicator: config.get<boolean>('showPlayingIndicator', true),
    resumeRewindMs: config.get<number>('resumeRewindMs', 600),
  };
}

async function getAuthHeaders(context: vscode.ExtensionContext): Promise<Record<string, string>> {
  const token = await context.secrets.get(SECRET_TOKEN_KEY);
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

async function getElevenLabsApiKey(context: vscode.ExtensionContext): Promise<string> {
  const secure = await context.secrets.get(SECRET_ELEVENLABS_KEY);
  if (secure && secure.trim()) {
    return secure.trim();
  }

  const fromSettings = vscode.workspace
    .getConfiguration('vartermCursor')
    .get<string>('elevenLabsApiKey', '');
  return (fromSettings || '').trim();
}

async function getRequestHeaders(
  context: vscode.ExtensionContext,
  includeJsonContentType = true
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    ...(includeJsonContentType ? { 'Content-Type': 'application/json' } : {}),
    ...(await getAuthHeaders(context)),
  };

  const elevenLabsKey = await getElevenLabsApiKey(context);
  if (elevenLabsKey) {
    headers['X-ElevenLabs-Api-Key'] = elevenLabsKey;
  }
  return headers;
}

function createHttpClient(context: vscode.ExtensionContext, options?: { retries?: number; timeoutMs?: number }) {
  const settings = getSettings();
  return createTtsHttpClient({
    baseUrl: getBaseUrl(context),
    retries: options?.retries ?? settings.requestRetries,
    timeoutMs: options?.timeoutMs ?? settings.requestTimeoutMs,
    getHeaders: (includeJsonContentType) => getRequestHeaders(context, includeJsonContentType),
  });
}

async function postJson<T>(
  context: vscode.ExtensionContext,
  path: string,
  payload: unknown,
  options?: { retries?: number; timeoutMs?: number; cancellationToken?: vscode.CancellationToken }
): Promise<T> {
  const client = createHttpClient(context, options);
  return client.postJson<T>(path, payload, options);
}

async function postBinary(
  context: vscode.ExtensionContext,
  path: string,
  payload: unknown,
  options?: { retries?: number; timeoutMs?: number; cancellationToken?: vscode.CancellationToken }
): Promise<Uint8Array> {
  const client = createHttpClient(context, options);
  return client.postBinary(path, payload, options);
}

async function getJson<T>(
  context: vscode.ExtensionContext,
  path: string,
  options?: { retries?: number; timeoutMs?: number }
): Promise<T> {
  const client = createHttpClient(context, options);
  return client.getJson<T>(path, options);
}

async function connect(context: vscode.ExtensionContext): Promise<void> {
  const currentBaseUrl = getBaseUrl(context);
  const baseUrl = await vscode.window.showInputBox({
    title: 'Varterm API Base URL',
    prompt: 'Enter your Varterm deployment URL',
    value: currentBaseUrl,
    ignoreFocusOut: true,
  });

  if (!baseUrl) {
    return;
  }

  await context.globalState.update(BASE_URL_KEY, baseUrl.trim());

  const token = await vscode.window.showInputBox({
    title: 'Varterm API Token',
    prompt: 'Optional bearer token (leave empty for public endpoints)',
    password: true,
    ignoreFocusOut: true,
  });

  if (token && token.trim()) {
    await context.secrets.store(SECRET_TOKEN_KEY, token.trim());
  } else {
    await context.secrets.delete(SECRET_TOKEN_KEY);
  }

  const existingElevenLabsKey = await context.secrets.get(SECRET_ELEVENLABS_KEY);
  const elevenLabsKey = await vscode.window.showInputBox({
    title: 'ElevenLabs API Key (optional)',
    prompt: 'Optional key for Premium TTS. Leave empty to keep current value.',
    password: true,
    ignoreFocusOut: true,
  });

  if (elevenLabsKey !== undefined) {
    if (elevenLabsKey.trim()) {
      await context.secrets.store(SECRET_ELEVENLABS_KEY, elevenLabsKey.trim());
    } else if (existingElevenLabsKey) {
      // Keep previously stored secret when user submits empty value.
    } else {
      await context.secrets.delete(SECRET_ELEVENLABS_KEY);
    }
  }

  vscode.window.showInformationMessage('Varterm connection saved.');
}

async function setElevenLabsApiKey(context: vscode.ExtensionContext): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: 'Set ElevenLabs API Key',
    prompt: 'Paste key to store securely. Leave empty to clear.',
    password: true,
    ignoreFocusOut: true,
  });

  if (value === undefined) {
    return;
  }

  if (value.trim()) {
    await context.secrets.store(SECRET_ELEVENLABS_KEY, value.trim());
    vscode.window.showInformationMessage('ElevenLabs API key saved in secure storage.');
    return;
  }

  await context.secrets.delete(SECRET_ELEVENLABS_KEY);
  vscode.window.showInformationMessage('ElevenLabs API key cleared from secure storage.');
}

async function fetchVoices(context: vscode.ExtensionContext): Promise<VoiceOption[]> {
  const [edgeResult, premiumResult] = await Promise.allSettled([
    getJson<{ voices: Array<{ id: string; name: string; style?: string; lang?: string }> }>(
      context,
      '/api/edge-tts'
    ),
    getJson<{
      voices: Array<{ id: string; name: string; description?: string; gender?: string }>;
      premium_available?: boolean;
    }>(context, '/api/tts'),
  ]);

  const voices: VoiceOption[] = [];

  if (edgeResult.status === 'fulfilled' && Array.isArray(edgeResult.value.voices)) {
    for (const voice of edgeResult.value.voices) {
      voices.push({
        id: voice.id,
        label: `${voice.name} (${voice.id})`,
        description: [voice.lang, voice.style].filter(Boolean).join(' • ') || 'Edge voice',
        provider: 'edge',
      });
    }
  }

  const premiumAvailable =
    premiumResult.status === 'fulfilled' && Boolean(premiumResult.value.premium_available);

  if (premiumResult.status === 'fulfilled' && Array.isArray(premiumResult.value.voices)) {
    for (const voice of premiumResult.value.voices) {
      voices.push({
        id: voice.id,
        label: `${voice.name} (Premium)`,
        description:
          [
            voice.description,
            voice.gender,
            premiumAvailable ? 'ready' : 'needs ElevenLabs key',
          ]
            .filter(Boolean)
            .join(' • ') || 'Premium voice',
        provider: 'premium',
      });
    }
  }

  return voices;
}

function currentVoiceId(context: vscode.ExtensionContext): string {
  return context.globalState.get<string>(VOICE_ID_KEY) || getSettings().readAloudVoice;
}

function previewLineForVoice(voice: VoiceOption): string {
  const name = voice.label.split(' (')[0]?.trim() || 'this voice';
  return `Hi, this is ${name}.`;
}

async function applyVoice(context: vscode.ExtensionContext, voice: VoiceOption): Promise<void> {
  await context.globalState.update(VOICE_ID_KEY, voice.id);
  await context.globalState.update(VOICE_NAME_KEY, voice.label);
  await context.globalState.update(VOICE_PROVIDER_KEY, voice.provider);
  await tryUpdateUserSetting('readAloudVoice', voice.id);
  await tryUpdateUserSetting('readAloudProvider', voice.provider);
  logInfo(`Voice set to ${voice.label}`);
  const shouldReread =
    Boolean(latestSpoken?.text) &&
    (playbackState === 'playing' || playbackState === 'paused' || playbackState === 'generating');
  if (shouldReread && latestSpoken) {
    await readTextAloud(context, latestSpoken.text, latestSpoken.label, { replace: true });
  }
}

const previewCache = new Map<string, Uint8Array>();
const PREVIEW_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('unmute'),
  tooltip: 'Play a short preview',
};

function previewCacheKey(voice: VoiceOption, rate: number): string {
  return `${voice.provider}:${voice.id}:${rate}`;
}

function startPreviewAfplay(filePath: string, generation: number): void {
  if (generation !== previewGeneration || process.platform !== 'darwin') {
    return;
  }
  if (previewProcess) {
    forceKillChild(previewProcess);
    previewProcess = undefined;
  }
  const child = spawn('/usr/bin/afplay', [filePath], {
    stdio: 'ignore',
    env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
  });
  previewProcess = child;
  child.on('close', () => {
    if (previewProcess === child) {
      previewProcess = undefined;
    }
  });
}

async function playPreviewBytes(
  context: vscode.ExtensionContext,
  audioBytes: Uint8Array,
  generation: number
): Promise<void> {
  if (generation !== previewGeneration || audioBytes.byteLength < 100) {
    return;
  }
  const outputDir = audioCacheDir(context);
  await vscode.workspace.fs.createDirectory(outputDir);
  const uri = vscode.Uri.joinPath(outputDir, `varterm-preview.mp3`);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(audioBytes));
  if (generation !== previewGeneration) {
    return;
  }
  startPreviewAfplay(uri.fsPath, generation);
}

async function previewVoice(context: vscode.ExtensionContext, voice: VoiceOption): Promise<void> {
  const rate = getReadAloudRate(context);
  const cacheKey = previewCacheKey(voice, rate);
  const cached = previewCache.get(cacheKey);

  stopPreviewPlayback();
  const generation = previewGeneration;
  const cts = new vscode.CancellationTokenSource();
  previewCts = cts;

  if (playbackState === 'playing') {
    pauseHostPlayback();
  }

  if (cached) {
    logInfo(`Voice preview cache ${voice.id}`);
    await playPreviewBytes(context, cached, generation);
    return;
  }

  const endpoint = voice.provider === 'premium' ? '/api/tts' : '/api/edge-tts';
  const text = previewLineForVoice(voice);
  const payload =
    voice.provider === 'premium'
      ? { text, voiceId: voice.id, speed: rate }
      : { text, voice: voice.id, rate };

  try {
    const audioBytes = await postBinary(context, endpoint, payload, {
      cancellationToken: cts.token,
      retries: 0,
      timeoutMs: 12000,
    });
    if (generation !== previewGeneration || cts.token.isCancellationRequested) {
      return;
    }
    if (audioBytes.byteLength < 100) {
      throw new Error('Preview audio was empty.');
    }
    previewCache.set(cacheKey, audioBytes);
    logInfo(`Voice preview ${voice.id} (${audioBytes.byteLength} bytes)`);
    await playPreviewBytes(context, audioBytes, generation);
  } catch (error) {
    if (isReadCancelled(error) || cts.token.isCancellationRequested) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    logInfo(`Voice preview failed (${voice.id}): ${message}`);
    vscode.window.showWarningMessage(`Varterm could not preview ${voice.label.split(' (')[0]}.`);
  }
}

async function selectReadAloudVoice(context: vscode.ExtensionContext): Promise<void> {
  const voices = await fetchVoices(context);
  if (!voices.length) {
    throw new Error('No voices available. Check your API base URL and try again.');
  }

  type VoiceItem = vscode.QuickPickItem & { voice: VoiceOption };
  const currentId = currentVoiceId(context);
  const items: VoiceItem[] = voices.map((voice) => ({
    label: voice.id === currentId ? `$(check) ${voice.label}` : voice.label,
    description: `${voice.provider.toUpperCase()} • ${voice.description}`,
    voice,
    buttons: [PREVIEW_BUTTON],
  }));

  const picker = vscode.window.createQuickPick<VoiceItem>();
  picker.title = 'Varterm voice';
  picker.placeholder = 'Click the speaker to preview. Press Enter to use the highlighted voice.';
  picker.matchOnDescription = true;
  picker.ignoreFocusOut = true;
  picker.items = items;
  const current = items.find((item) => item.voice.id === currentId);
  if (current) {
    picker.activeItems = [current];
  }

  const runPreview = (voice: VoiceOption | undefined) => {
    if (!voice) {
      return;
    }
    picker.busy = true;
    void previewVoice(context, voice).finally(() => {
      picker.busy = false;
    });
  };

  picker.onDidTriggerItemButton((event) => {
    runPreview(event.item.voice);
  });

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      stopPreviewPlayback();
      picker.dispose();
      resolve();
    };

    picker.onDidAccept(() => {
      const voice = picker.selectedItems[0]?.voice || picker.activeItems[0]?.voice;
      picker.hide();
      finish();
      if (voice) {
        void applyVoice(context, voice);
      }
    });
    picker.onDidHide(() => {
      finish();
    });
    picker.show();
  });
}

function looksLikeBinary(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, 2000);
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
    if (byte < 7 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }
  return suspicious > sample.length * 0.2;
}

async function ingestDocuments(context: vscode.ExtensionContext): Promise<void> {
  const settings = getSettings();
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFolders: false,
    canSelectFiles: true,
    openLabel: 'Ingest with Varterm',
    filters: {
      'Text and code': [
        'txt',
        'md',
        'js',
        'jsx',
        'ts',
        'tsx',
        'py',
        'java',
        'go',
        'rb',
        'rs',
        'c',
        'cpp',
        'h',
        'hpp',
        'json',
        'yaml',
        'yml',
        'toml',
        'xml',
        'html',
        'css',
        'scss',
        'sql',
        'sh',
      ],
    },
  });

  if (!uris || !uris.length) {
    return;
  }

  if (uris.length > MAX_TOTAL_FILES) {
    throw new Error(`Too many files selected. Maximum is ${MAX_TOTAL_FILES}.`);
  }

  const progressTitle = `Varterm: preparing ${uris.length} file(s)`;
  const documents: Array<{ path: string; content: string }> = [];
  let totalChars = 0;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: progressTitle,
      cancellable: true,
    },
    async (progress, token) => {
      for (let i = 0; i < uris.length; i += 1) {
        if (token.isCancellationRequested) {
          throw new Error('Ingestion cancelled');
        }
        const uri = uris[i];
        progress.report({
          message: `${i + 1}/${uris.length}: ${uri.path.split('/').pop() || uri.path}`,
        });

        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength > MAX_FILE_BYTES) {
          throw new Error(`File is too large (${uri.fsPath}). Max size is ${MAX_FILE_BYTES} bytes.`);
        }
        if (looksLikeBinary(bytes)) {
          throw new Error(`Binary file detected and skipped: ${uri.fsPath}`);
        }

        const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        totalChars += content.length;
        if (totalChars > settings.maxTotalTextChars) {
          throw new Error(
            `Combined text is too large. Max supported total is ${settings.maxTotalTextChars} characters.`
          );
        }

        documents.push({
          path: vscode.workspace.asRelativePath(uri, false) || uri.path,
          content,
        });
      }

      progress.report({ message: 'Uploading chunks to Varterm...' });
      const response = await postJson<{ success: boolean; result: IngestResult }>(
        context,
        '/api/ingest',
        {
          documents,
          options: {
            chunkSize: settings.chunkSize,
            overlap: settings.chunkOverlap,
            maxChunks: 2000,
            maxTotalChars: settings.maxTotalTextChars,
          },
        },
        { cancellationToken: token }
      );

      await context.workspaceState.update(SESSION_KEY, {
        sessionId: response.result.sessionId,
        ingestedAt: Date.now(),
        baseUrl: getBaseUrl(context),
      });

      const warning = response.result.truncated ? ' Some content was truncated by limits.' : '';
      vscode.window.showInformationMessage(
        `Ingested ${response.result.documentCount} file(s), ${response.result.chunkCount} chunks.${warning}`
      );
    }
  );
}

async function ingestPayload(
  context: vscode.ExtensionContext,
  documents: Array<{ path: string; content: string }>
): Promise<void> {
  const settings = getSettings();
  const response = await postJson<{ success: boolean; result: IngestResult }>(context, '/api/ingest', {
    documents,
    options: {
      chunkSize: settings.chunkSize,
      overlap: settings.chunkOverlap,
      maxChunks: 2000,
      maxTotalChars: settings.maxTotalTextChars,
    },
  });

  await context.workspaceState.update(SESSION_KEY, {
    sessionId: response.result.sessionId,
    ingestedAt: Date.now(),
    baseUrl: getBaseUrl(context),
  });

  const warning = response.result.truncated ? ' Some content was truncated by limits.' : '';
  vscode.window.showInformationMessage(
    `Ingested ${response.result.documentCount} file(s), ${response.result.chunkCount} chunks.${warning}`
  );
}

function getEditorDocPath(document: vscode.TextDocument): string {
  if (document.uri.scheme === 'file') {
    return vscode.workspace.asRelativePath(document.uri, false) || document.uri.fsPath;
  }
  return `${document.uri.scheme}:${document.uri.path || document.uri.toString()}`;
}

async function ingestActiveEditor(context: vscode.ExtensionContext): Promise<void> {
  const settings = getSettings();
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error('No active editor to ingest.');
  }

  const selected = editor.document.getText(editor.selection).trim();
  const content = selected || editor.document.getText().trim();
  if (!content) {
    throw new Error('Active editor has no text to ingest.');
  }
  if (content.length > settings.maxTotalTextChars) {
    throw new Error(
      `Editor text is too large. Max supported total is ${settings.maxTotalTextChars} characters.`
    );
  }

  await ingestPayload(context, [{ path: getEditorDocPath(editor.document), content }]);
}

async function resolveSourceUri(sourcePath: string): Promise<vscode.Uri | null> {
  if (!sourcePath) {
    return null;
  }

  const directUri = vscode.Uri.file(sourcePath);
  try {
    await vscode.workspace.fs.stat(directUri);
    return directUri;
  } catch {
    // Continue and try workspace-relative resolution.
  }

  const folders = vscode.workspace.workspaceFolders || [];
  for (const folder of folders) {
    const candidate = vscode.Uri.joinPath(folder.uri, sourcePath);
    try {
      await vscode.workspace.fs.stat(candidate);
      return candidate;
    } catch {
      // Try next folder.
    }
  }

  return null;
}

async function openSource(source: AskSource): Promise<void> {
  const uri = await resolveSourceUri(source.path);
  if (!uri) {
    throw new Error(`Cannot locate source file: ${source.path}`);
  }

  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preview: false });

  const startChar = Math.max(0, source.startChar ?? 0);
  const endChar = Math.max(startChar, source.endChar ?? startChar + 1);
  const selection = new vscode.Selection(document.positionAt(startChar), document.positionAt(endChar));
  editor.selection = selection;
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
}

async function maybeOpenSourceFromAnswer(sources: AskSource[]): Promise<void> {
  if (!sources.length) {
    return;
  }

  const action = await vscode.window.showInformationMessage(
    'Varterm answer ready.',
    'Open a source file'
  );
  if (action !== 'Open a source file') {
    return;
  }

  const picked = await vscode.window.showQuickPick(
    sources.map((source) => ({
      label: source.path,
      description: `chunk ${source.chunk + 1}, score ${source.score}`,
      source,
    })),
    { placeHolder: 'Select a source to open' }
  );

  if (picked?.source) {
    await openSource(picked.source);
  }
}

async function askAI(context: vscode.ExtensionContext): Promise<void> {
  const settings = getSettings();
  const question = await vscode.window.showInputBox({
    title: 'Ask Varterm AI',
    prompt: 'Ask a question about your ingested files',
    ignoreFocusOut: true,
  });
  if (!question || !question.trim()) {
    return;
  }

  const session = context.workspaceState.get<{ sessionId?: string }>(SESSION_KEY);
  if (!session?.sessionId) {
    throw new Error('No active ingestion session. Run "Varterm: Ingest Documents" first.');
  }

  const response = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Varterm: asking AI',
      cancellable: true,
    },
    async (progress, token) => {
      progress.report({ message: 'Ranking context and generating answer...' });
      return postJson<{
        success: boolean;
        result: {
          answer: string;
          sources: AskSource[];
        };
      }>(
        context,
        '/api/ask',
        {
          sessionId: session.sessionId,
          question: question.trim(),
          maxChunks: settings.askMaxChunks,
          maxContextChars: settings.askMaxContextChars,
        },
        { cancellationToken: token }
      );
    }
  );

  const output = vscode.window.createOutputChannel('Varterm');
  output.clear();
  output.appendLine(`Q: ${question.trim()}`);
  output.appendLine('');
  output.appendLine(response.result.answer);
  output.appendLine('');
  output.appendLine('Sources:');
  for (const source of response.result.sources) {
    output.appendLine(`- ${source.path} (chunk ${source.chunk + 1}, score ${source.score})`);
  }
  output.show(true);

  const readAction = settings.autoReadAnswersAloud
    ? 'Reading answer aloud...'
    : (await vscode.window.showInformationMessage('Varterm answer ready.', 'Read answer aloud'));

  if (settings.autoReadAnswersAloud || readAction === 'Read answer aloud') {
    await readTextAloud(context, response.result.answer, 'answer', { replace: true });
  }

  await maybeOpenSourceFromAnswer(response.result.sources);
}

class ReadCancelledError extends Error {
  readonly name = 'ReadCancelledError';
  constructor() {
    super('Cancelled');
  }
}

function isReadCancelled(error: unknown): boolean {
  if (error instanceof ReadCancelledError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message === 'Cancelled' || error.message === 'Operation cancelled';
}

function cancelCurrentRead(): void {
  readGeneration += 1;
  const previous = generationCts;
  generationCts = undefined;
  isGeneratingAudio = false;
  previous?.cancel();
}

function beginReadSession(): { generation: number; cts: vscode.CancellationTokenSource } {
  const previous = generationCts;
  generationCts = undefined;
  isGeneratingAudio = false;
  previous?.cancel();
  const cts = new vscode.CancellationTokenSource();
  const generation = ++readGeneration;
  generationCts = cts;
  isGeneratingAudio = true;
  return { generation, cts };
}

function isCurrentRead(generation: number, cts: vscode.CancellationTokenSource): boolean {
  return generation === readGeneration && generationCts === cts;
}

function rememberPlayback(tracks: AudioTrack[], label: string): void {
  latestPlayback = { tracks: tracks.slice(), label };
  if (label === 'agent reply') {
    lastAgentPlayback = { tracks: tracks.slice(), label };
  }
}

async function readTextAloud(
  context: vscode.ExtensionContext,
  text: string,
  label: string,
  options?: { replace?: boolean; onStarted?: () => void; fromQueue?: boolean }
): Promise<void> {
  logInfo(`readTextAloud start: label=${label}, chars=${text.length}`);
  const replace = options?.replace !== false;
  const settings = getSettings();
  const normalized = stripForSpeech(text);
  if (!normalized) {
    throw new Error('No text available to read aloud.');
  }

  const busy = isPlaybackBusy();
  const otherOwns = anotherWindowOwnsPlayback();
  if (label === 'agent reply' && !options?.fromQueue && (busy || otherOwns)) {
    if (enqueueListen({ text: normalized, label })) {
      logInfo(
        otherOwns
          ? `Another window is playing; queued agent reply (${listenQueue.length} waiting)`
          : `Queued agent reply (${listenQueue.length} waiting)`
      );
    }
    options?.onStarted?.();
    return;
  }
  if (options?.fromQueue && otherOwns) {
    enqueueListen({ text: normalized, label });
    logInfo('Another window still has the speaker; left this item in the queue');
    return;
  }
  if (busy && !options?.fromQueue) {
    const snap = currentListenSnapshot();
    if (snap) {
      pushListenHistory(snap);
    }
  }
  playbackClaimSteals = label !== 'agent reply';

  if (isGeneratingAudio && !replace) {
    const choice = await vscode.window.showWarningMessage(
      'Varterm is still generating audio.',
      'Cancel and start over',
      'Wait'
    );
    if (choice !== 'Cancel and start over') {
      return;
    }
  }

  const spokenRate = getReadAloudRate(context);
  const spokenVoiceId = context.globalState.get<string>(VOICE_ID_KEY) || settings.readAloudVoice;
  latestSpoken = { text: normalized, label, rate: spokenRate, voiceId: spokenVoiceId };

  const { generation, cts } = beginReadSession();
  const token = cts.token;
  const stillMine = () => isCurrentRead(generation, cts);
  stopHostPlayback();
  setPlaybackStatus('$(loading~spin)', 'generating');
  playerProvider?.post({ type: 'loading', label });

  try {
    const selectedVoiceId = context.globalState.get<string>(VOICE_ID_KEY) || settings.readAloudVoice;
    const selectedProvider =
      context.globalState.get<'edge' | 'premium'>(VOICE_PROVIDER_KEY) || settings.readAloudProvider;

    // Paragraph-sized tracks so each jump forward skips one remaining part, not the whole reply.
    const chunks = splitTextIntoChunks(normalized, 450);
    expectedTrackCount = chunks.length;
    waitingForChunk = undefined;
    playbackFiles = [];
    playbackIndex = 0;
    logInfo(`Using provider=${selectedProvider}, chunks=${chunks.length}`);

    const outputDir = audioCacheDir(context);
    await vscode.workspace.fs.createDirectory(outputDir);
    const stamp = Date.now();
    const files: string[] = [];
    const tracks: AudioTrack[] = [];
    let playDone: Promise<void> | undefined;

    for (let i = 0; i < chunks.length; i += 1) {
      const chunkText = chunks[i];
      logInfo(`Generating chunk ${i + 1}/${chunks.length}, chars=${chunkText.length}`);
      let providerToUse: 'edge' | 'premium' = selectedProvider;
      let voiceToUse = selectedVoiceId;
      let endpoint = providerToUse === 'premium' ? '/api/tts' : '/api/edge-tts';
      let payload =
        providerToUse === 'premium'
          ? { text: chunkText, voiceId: voiceToUse, speed: spokenRate }
          : { text: chunkText, voice: voiceToUse, rate: spokenRate };

      let audioBytes: Uint8Array;
      try {
        if (!stillMine() || token.isCancellationRequested) {
          throw new ReadCancelledError();
        }
        audioBytes = await postBinary(context, endpoint, payload, { cancellationToken: token });
      } catch (error) {
        if (!stillMine() || isReadCancelled(error)) {
          throw new ReadCancelledError();
        }
        const message = error instanceof Error ? error.message : String(error);
        const premiumKeyMissing =
          providerToUse === 'premium' && /ELEVENLABS_API_KEY|ElevenLabs/i.test(message);
        if (!premiumKeyMissing) {
          throw error;
        }

        providerToUse = 'edge';
        voiceToUse = 'en-US-AriaNeural';
        endpoint = '/api/edge-tts';
        payload = { text: chunkText, voice: voiceToUse, rate: spokenRate };
        audioBytes = await postBinary(context, endpoint, payload, { cancellationToken: token });

        await context.globalState.update(VOICE_PROVIDER_KEY, providerToUse);
        await context.globalState.update(VOICE_ID_KEY, voiceToUse);
        await context.globalState.update(VOICE_NAME_KEY, 'Aria (en-US-AriaNeural)');
        vscode.window.showWarningMessage(
          'Premium voice requires ELEVENLABS_API_KEY. Switched to Edge voice (Aria).'
        );
      }

      if (!stillMine()) {
        throw new ReadCancelledError();
      }

      const uri = vscode.Uri.joinPath(outputDir, `varterm-play-${stamp}-${i + 1}.mp3`);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(audioBytes));
      const stat = await vscode.workspace.fs.stat(uri);
      logInfo(`Audio file ${uri.fsPath} size=${stat.size}`);
      if (stat.size < 100) {
        throw new Error('Generated audio file was empty. Try again.');
      }

      tracks.push({
        title: chunks.length === 1 ? label : `${label} (part ${i + 1}/${chunks.length})`,
        base64: Buffer.from(audioBytes).toString('base64'),
      });
      files.push(uri.fsPath);
      rememberPlayback(tracks, label);
      playbackFiles = files;

      if (waitingForChunk !== undefined && waitingForChunk < files.length) {
        const resumeAt = waitingForChunk;
        waitingForChunk = undefined;
        startChunk(resumeAt, playGeneration);
      }

      if (!playDone) {
        if (process.platform !== 'darwin') {
          throw new Error('Background playback currently uses macOS afplay.');
        }
        setPlaybackStatus('$(debug-pause)', 'playing');
        logInfo(`Playing first of ${chunks.length} track(s) while generating the rest`);
        playDone = playFilesWithAfplay(files, 0);
        options?.onStarted?.();
      } else {
        refreshTransport();
      }
    }
    logInfo(`Generated audio tracks: ${tracks.length}`);

    if (!stillMine()) {
      throw new ReadCancelledError();
    }

    playerProvider?.post({
      type: 'ready',
      tracks,
      label,
      voiceName: context.globalState.get<string>(VOICE_NAME_KEY) || selectedVoiceId,
      provider: selectedProvider,
    });
    if (stillMine()) {
      isGeneratingAudio = false;
    }
    if (playDone) {
      try {
        await playDone;
      } finally {
        if (
          stillMine() &&
          (playbackState === 'playing' || playbackState === 'paused') &&
          playbackFiles === files
        ) {
          setIdleStatus();
          void maybeAdvanceQueue();
        }
        void pruneAudioCache(context);
      }
    }
  } catch (error) {
    if (!stillMine() || isReadCancelled(error)) {
      logInfo(`readTextAloud cancelled: label=${label}`);
      throw new ReadCancelledError();
    }
    expectedTrackCount = playbackFiles.length;
    if (waitingForChunk !== undefined && waitingForChunk >= expectedTrackCount) {
      waitingForChunk = undefined;
      playResolve?.();
      playResolve = undefined;
      playReject = undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    logInfo(`readTextAloud error: ${message}`);
    setPlaybackStatus('$(error) Varterm failed — click to retry', 'idle');
    getOutputChannel().show(true);
    playerProvider?.post({ type: 'error', label, message });
    throw error;
  } finally {
    cts.dispose();
    if (generationCts === cts) {
      isGeneratingAudio = false;
      generationCts = undefined;
    }
  }
}

function audioCacheDir(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, 'audio');
}

function toSafeFileStem(label: string): string {
  const cleaned = label
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || 'audio';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function listCachedAudio(outputDir: vscode.Uri): Promise<Array<{ uri: vscode.Uri; mtime: number; size: number }>> {
  let entries: Array<[string, vscode.FileType]>;
  try {
    entries = await vscode.workspace.fs.readDirectory(outputDir);
  } catch {
    return [];
  }

  const audioEntries = entries.filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.mp3'));
  return Promise.all(
    audioEntries.map(async ([name]) => {
      const uri = vscode.Uri.joinPath(outputDir, name);
      const stat = await vscode.workspace.fs.stat(uri);
      return { uri, mtime: stat.mtime, size: stat.size };
    })
  );
}

async function pruneAudioCache(context: vscode.ExtensionContext): Promise<void> {
  const settings = getSettings();
  const outputDir = audioCacheDir(context);
  const files = await listCachedAudio(outputDir);
  if (!files.length) {
    return;
  }

  const safeMaxFiles = Math.max(0, Math.min(200, settings.maxCachedAudioFiles));
  const maxAgeHours = Math.max(0, Math.min(24 * 90, settings.maxCachedAudioAgeHours));
  const now = Date.now();
  const expired =
    maxAgeHours > 0 ? files.filter((file) => now - file.mtime > maxAgeHours * 60 * 60 * 1000) : [];
  const expiredUris = new Set(expired.map((file) => file.uri.toString()));
  const remaining = files.filter((file) => !expiredUris.has(file.uri.toString()));

  remaining.sort((a, b) => b.mtime - a.mtime);
  const overLimit = remaining.slice(safeMaxFiles);
  const stale = [...expired, ...overLimit];
  await Promise.all(stale.map(async (file) => vscode.workspace.fs.delete(file.uri, { useTrash: false })));
  if (stale.length) {
    logInfo(`Pruned ${stale.length} cached audio file(s)`);
  }
}

async function saveLatestAudio(trackIndex = 0): Promise<void> {
  if (!latestPlayback?.tracks.length) {
    throw new Error('No audio is ready yet. Generate a reading first.');
  }

  const index = Math.max(0, Math.min(trackIndex, latestPlayback.tracks.length - 1));
  const stem = toSafeFileStem(latestPlayback.label);
  const defaultName =
    latestPlayback.tracks.length === 1 ? `varterm-${stem}.mp3` : `varterm-${stem}-part${index + 1}.mp3`;
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(defaultName),
    filters: { 'MP3 audio': ['mp3'] },
    saveLabel: 'Save MP3',
    title: 'Save Varterm audio',
  });
  if (!uri) {
    return;
  }

  await vscode.workspace.fs.writeFile(uri, Buffer.from(latestPlayback.tracks[index].base64, 'base64'));
  vscode.window.showInformationMessage(`Saved ${uri.fsPath.split('/').pop() || 'audio file'}.`);
}

async function clearAudioCache(context: vscode.ExtensionContext): Promise<void> {
  const outputDir = audioCacheDir(context);
  const audioEntries = await listCachedAudio(outputDir);
  if (!audioEntries.length) {
    vscode.window.showInformationMessage('No cached audio files found.');
    return;
  }

  const totalBytes = audioEntries.reduce((sum, file) => sum + file.size, 0);
  await Promise.all(audioEntries.map(async (file) => vscode.workspace.fs.delete(file.uri, { useTrash: false })));
  vscode.window.showInformationMessage(
    `Cleared ${audioEntries.length} cached audio file(s) (${formatBytes(totalBytes)}).`
  );
}

async function openSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', 'vartermCursor');
}

function formatShortcutDisplay(raw: string): string {
  return raw
    .replace(/cmd/gi, '⌘')
    .replace(/ctrl/gi, 'Ctrl')
    .replace(/shift/gi, 'Shift')
    .replace(/alt/gi, '⌥')
    .replace(/\+/g, '+');
}

function getShortcutLabel(command: keyof typeof SHIPPED_SHORTCUTS): string {
  const raw =
    process.platform === 'darwin' ? SHIPPED_SHORTCUTS[command].mac : SHIPPED_SHORTCUTS[command].win;
  return formatShortcutDisplay(raw);
}

async function openKeyboardShortcuts(): Promise<void> {
  await vscode.commands.executeCommand(
    'workbench.action.openGlobalKeybindings',
    '@ext:varterm.varterm-cursor'
  );
}

async function maybeShowShortcutsTip(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(SHORTCUTS_TIP_KEY)) {
    return;
  }

  const editor = getShortcutLabel('readEditorAloud');
  const choice = await vscode.window.showInformationMessage(
    `Varterm: Highlight text, then press ${editor} to hear it. Nothing is copied.`,
    'Customize shortcuts',
    'Got it'
  );

  if (choice === 'Customize shortcuts') {
    await openKeyboardShortcuts();
  }

  await context.globalState.update(SHORTCUTS_TIP_KEY, true);
}

function showPlayerNeedText(): void {
  playerProvider?.post({ type: 'needText' });
  vscode.window.showWarningMessage(
    'Nothing to read. Highlight text in the editor, or copy something first.'
  );
}

function handlePlayerMessage(context: vscode.ExtensionContext, message: Record<string, unknown>): void {
  // Leave the webview message turn before starting work so focus/generation cannot deadlock.
  setTimeout(() => {
    void (async () => {
      try {
        if (message?.type === 'changeVoice') {
          await selectReadAloudVoice(context);
          return;
        }

        if (message?.type === 'setProvider') {
          const provider = message.value === 'premium' ? 'premium' : 'edge';
          await tryUpdateUserSetting('readAloudProvider', provider);
          await context.globalState.update(VOICE_PROVIDER_KEY, provider);
          return;
        }

        if (message?.type === 'readPasted' && typeof message.text === 'string') {
          await readTextAloud(context, message.text, 'pasted', { replace: true });
          return;
        }

        if (message?.type === 'runCommand' && typeof message.command === 'string') {
          await vscode.commands.executeCommand(message.command);
          return;
        }

        if (message?.type === 'saveAudio') {
          await saveLatestAudio(Number(message.trackIndex) || 0);
          return;
        }

        if (message?.type === 'playerError' && typeof message.detail === 'string') {
          logInfo(`Webview player error: ${message.detail}`);
        }
      } catch (error) {
        if (isReadCancelled(error)) {
          return;
        }
        const detail = error instanceof Error ? error.message : 'Unexpected error';
        vscode.window.showErrorMessage(`Varterm: ${detail}`);
      }
    })();
  }, 0);
}

function splitTextIntoChunks(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];

  const pushSized = (block: string) => {
    if (block.length <= maxChars) {
      chunks.push(block);
      return;
    }
    let start = 0;
    while (start < block.length) {
      const end = Math.min(start + maxChars, block.length);
      let slice = block.slice(start, end);
      if (end < block.length) {
        const breakIndex = Math.max(
          slice.lastIndexOf('. '),
          slice.lastIndexOf('? '),
          slice.lastIndexOf('! '),
          slice.lastIndexOf('\n'),
          slice.lastIndexOf(' ')
        );
        if (breakIndex > Math.floor(maxChars * 0.35)) {
          slice = slice.slice(0, breakIndex + 1);
        }
      }
      const piece = slice.trim();
      if (piece) {
        chunks.push(piece);
      }
      start += Math.max(1, slice.length);
    }
  };

  let current = '';
  for (const para of paragraphs) {
    if (!current) {
      current = para;
      continue;
    }
    if (current.length + 2 + para.length <= 180) {
      current = `${current}\n\n${para}`;
      continue;
    }
    pushSized(current);
    current = para;
  }
  if (current) {
    pushSized(current);
  }
  return chunks;
}

async function handleStatusBarAction(context: vscode.ExtensionContext): Promise<void> {
  if (playbackState === 'playing') {
    pauseHostPlayback();
    return;
  }

  if (playbackState === 'paused') {
    resumeHostPlayback();
    return;
  }

  if (playbackState === 'generating') {
    cancelCurrentRead();
    stopHostPlayback();
    setIdleStatus();
    return;
  }

  const highlighted = await resolveHighlightedText();
  if (highlighted) {
    await readTextAloud(context, highlighted.text, highlighted.label, { replace: true });
    return;
  }

  if (await replayWithCurrentSettings(context)) {
    return;
  }

  if (latestPlayback?.tracks.length) {
    await playTracksInCursor(context, latestPlayback.tracks);
    return;
  }

  if (lastAgentPlayback?.tracks.length) {
    latestPlayback = lastAgentPlayback;
    await playTracksInCursor(context, lastAgentPlayback.tracks);
    return;
  }

  const lastAgent = readLastAgentText();
  if (lastAgent) {
    await readTextAloud(context, lastAgent, 'agent reply', { replace: true });
    return;
  }

  const clipboard = await freshClipboardText();
  if (clipboard) {
    await readTextAloud(context, clipboard, 'clipboard', { replace: true });
  }
}

async function maybeShowAutoReadTip(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(AUTO_READ_TIP_KEY)) {
    return;
  }
  if (getAutoReadEnabled(context) || getSettings().autoReadAgentOutput) {
    await context.globalState.update(AUTO_READ_TIP_KEY, true);
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    'Turn on Varterm Auto-read to hear assistant replies when they finish. Pause, replay, or stop from the status bar.',
    'Turn on Auto-read',
    'Not now'
  );
  await context.globalState.update(AUTO_READ_TIP_KEY, true);
  if (choice === 'Turn on Auto-read') {
    await setAutoReadEnabled(context, true);
  }
}

async function readEditorAloud(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const selected = selectionToRead();
  const fallback = editor?.document.getText().trim() || '';
  const text = selected || fallback;

  if (text) {
    await readTextAloud(context, text, selected ? 'selection' : 'document', { replace: true });
    return;
  }

  const clipboard = (await vscode.env.clipboard.readText()).trim();
  if (clipboard) {
    await readTextAloud(context, clipboard, 'clipboard', { replace: true });
    return;
  }

  showPlayerNeedText();
}

async function readClipboardAloud(context: vscode.ExtensionContext): Promise<void> {
  const clipboard = (await vscode.env.clipboard.readText()).trim();
  if (clipboard) {
    await readTextAloud(context, clipboard, 'clipboard', { replace: true });
    return;
  }

  showPlayerNeedText();
}

async function readSelectionAloud(context: vscode.ExtensionContext): Promise<void> {
  const highlighted = await resolveHighlightedText();
  if (highlighted) {
    await readTextAloud(context, highlighted.text, highlighted.label, { replace: true });
    return;
  }

  vscode.window.showWarningMessage(
    'Highlight text in a file or a plan, then press the selection button. Chat highlights still need a copy first.'
  );
}

async function readSelectionOrClipboard(context: vscode.ExtensionContext): Promise<void> {
  const highlighted = await resolveHighlightedText();
  if (highlighted) {
    await readTextAloud(context, highlighted.text, highlighted.label, { replace: true });
    return;
  }

  const clipboard = await freshClipboardText();
  if (clipboard) {
    await readTextAloud(context, clipboard, 'clipboard', { replace: true });
    return;
  }

  vscode.window.showWarningMessage(
    'Could not read that highlight. Copy it first (Cmd+C / Ctrl+C), then press the button again. Old clipboard text is ignored. Copy a single space if you want to clear it.'
  );
}

function diagnosticSeverityLabel(severity: vscode.DiagnosticSeverity): string | undefined {
  if (severity === vscode.DiagnosticSeverity.Error) {
    return 'Error';
  }
  if (severity === vscode.DiagnosticSeverity.Warning) {
    return 'Warning';
  }
  return undefined;
}

async function readErrorsAloud(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const entries: Array<[vscode.Uri, readonly vscode.Diagnostic[]]> = editor
    ? [[editor.document.uri, vscode.languages.getDiagnostics(editor.document.uri)]]
    : vscode.languages.getDiagnostics();

  const parts: string[] = [];
  for (const [uri, diagnostics] of entries) {
    const fileName = editor ? '' : uri.path.split('/').pop() || uri.fsPath;
    for (const diagnostic of diagnostics) {
      const severity = diagnosticSeverityLabel(diagnostic.severity);
      if (!severity) {
        continue;
      }
      const line = diagnostic.range.start.line + 1;
      const where = fileName
        ? `${severity} in ${fileName} on line ${line}`
        : `${severity} on line ${line}`;
      const message = diagnostic.message.replace(/\s+/g, ' ').trim();
      parts.push(`${where}: ${message}`);
    }
  }

  if (!parts.length) {
    vscode.window.showInformationMessage('No errors or warnings found.');
    return;
  }

  const intro = parts.length === 1 ? 'Found 1 issue.' : `Found ${parts.length} issues.`;
  await readTextAloud(context, `${intro} ${parts.join('. ')}`, 'diagnostics', { replace: true });
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;

  // Left-aligned status bar items render highest priority first, so these
  // descend in the order they should appear. Keeping them contiguous matters:
  // the Auto-read label used to sit at 79, between the meter and Stop, which
  // split the transport into two halves with a word wedged in the middle.
  //
  //   jump back | play/pause | stop | jump forward | replay | meter | Auto-read | listen | speed
  const ORDER = {
    jumpBack: 90,
    playPause: 89,
    stop: 88,
    jumpForward: 87,
    replay: 86,
    queue: 85,
    meter: 84,
    autoRead: 83,
    listen: 82,
    speed: 81,
  };

  jumpBackBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, ORDER.jumpBack);
  jumpBackBar.command = 'vartermCursor.jumpBack';
  context.subscriptions.push(jumpBackBar);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, ORDER.playPause);
  statusBar.show();
  context.subscriptions.push(statusBar);
  setIdleStatus();

  stopStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, ORDER.stop);
  stopStatusBar.command = 'vartermCursor.stopPlayback';
  context.subscriptions.push(stopStatusBar);

  jumpForwardBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    ORDER.jumpForward
  );
  jumpForwardBar.command = 'vartermCursor.jumpForward';
  context.subscriptions.push(jumpForwardBar);

  replayBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, ORDER.replay);
  replayBar.command = 'vartermCursor.replayLast';
  context.subscriptions.push(replayBar);

  queueBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, ORDER.queue);
  queueBar.command = 'vartermCursor.openListenQueue';
  context.subscriptions.push(queueBar);

  playingIndicator = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, ORDER.meter);
  playingIndicator.command = 'vartermCursor.statusBarAction';
  context.subscriptions.push(playingIndicator);
  context.subscriptions.push({ dispose: stopIndicatorAnimation });

  autoReadStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    ORDER.autoRead
  );
  autoReadStatusBar.command = 'vartermCursor.toggleAutoRead';
  context.subscriptions.push(autoReadStatusBar);
  setAutoReadStatus(loadAutoReadEnabled(context, getSettings().autoReadAgentOutput));

  listenBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, ORDER.listen);
  listenBar.command = 'vartermCursor.readSelectionOrClipboard';
  context.subscriptions.push(listenBar);
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const text = event.textEditor.document.getText(event.textEditor.selection).trim();
      if (text) {
        rememberedSelection = text;
      }
      refreshListenBar();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => refreshListenBar()),
    vscode.window.tabGroups.onDidChangeTabs(() => refreshListenBar())
  );
  refreshListenBar();

  speedBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, ORDER.speed);
  speedBar.command = 'vartermCursor.openPlaybackMenu';
  context.subscriptions.push(speedBar);
  refreshSpeedBar();

  playbackLockWatcher = watchPlaybackLock(handlePlaybackLockChange);
  context.subscriptions.push({ dispose: () => playbackLockWatcher?.dispose() });
  handlePlaybackLockChange();

  refreshTransport();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('vartermCursor.showPlayingIndicator')) {
        refreshPlayingIndicator();
      }
      if (event.affectsConfiguration('vartermCursor.readAloudRate')) {
        refreshSpeedBar();
      }
      if (!event.affectsConfiguration('vartermCursor.autoReadAgentOutput')) {
        return;
      }
      // Status bar is per-window. Do not copy a settings.json write from
      // another window. Only honor the setting before this workspace has a
      // local toggle stored.
      if (context.workspaceState.get(AUTO_READ_KEY) !== undefined) {
        return;
      }
      const enabled = getSettings().autoReadAgentOutput;
      if (enabled === getAutoReadEnabled(context) && Boolean(autoReadWatcher) === enabled) {
        return;
      }
      void setAutoReadEnabled(context, enabled);
    })
  );

  playerProvider = new VartermPlayerViewProvider((message) => handlePlayerMessage(context, message));
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PLAYER_VIEW_ID, playerProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  const register = (command: string, handler: () => Promise<void>) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async () => {
        try {
          await handler();
        } catch (error) {
          if (isReadCancelled(error)) {
            return;
          }
          const message = error instanceof Error ? error.message : 'Unexpected error';
          vscode.window.showErrorMessage(`Varterm: ${message}`);
        }
      })
    );
  };

  register('vartermCursor.connect', () => connect(context));
  register('vartermCursor.setElevenLabsApiKey', () => setElevenLabsApiKey(context));
  register('vartermCursor.selectReadAloudVoice', () => selectReadAloudVoice(context));
  register('vartermCursor.openPlaybackMenu', () => openPlaybackMenu(context));
  register('vartermCursor.readEditorAloud', () => readEditorAloud(context));
  register('vartermCursor.readClipboardAloud', () => readClipboardAloud(context));
  register('vartermCursor.readSelectionAloud', () => readSelectionAloud(context));
  register('vartermCursor.readSelectionOrClipboard', () => readSelectionOrClipboard(context));
  register('vartermCursor.readErrorsAloud', () => readErrorsAloud(context));
  register('vartermCursor.readLastAgentReply', async () => {
    if (lastAgentPlayback?.tracks.length) {
      latestPlayback = lastAgentPlayback;
      await playTracksInCursor(context, lastAgentPlayback.tracks);
      return;
    }
    const text = readLastAgentText();
    if (!text) {
      throw new Error('No agent reply captured yet. Leave Auto-read on and wait for a reply to finish.');
    }
    await readTextAloud(context, text, 'agent reply', { replace: true });
  });
  register('vartermCursor.openSettings', () => openSettings());
  register('vartermCursor.openKeyboardShortcuts', () => openKeyboardShortcuts());
  register('vartermCursor.clearAudioCache', () => clearAudioCache(context));
  register('vartermCursor.openListenQueue', () => openListenQueue(context));
  register('vartermCursor.stopPlayback', async () => {
    const snap = currentListenSnapshot();
    if (snap) {
      pushListenHistory(snap);
    }
    cancelCurrentRead();
    stopHostPlayback();
    setIdleStatus();
    refreshQueueBar();
  });
  register('vartermCursor.pausePlayback', async () => {
    if (!pauseHostPlayback()) {
      throw new Error('Nothing is playing.');
    }
  });
  register('vartermCursor.resumePlayback', async () => {
    if (!resumeHostPlayback()) {
      throw new Error('Nothing is paused.');
    }
  });
  register('vartermCursor.replayLast', async () => {
    if (await replayWithCurrentSettings(context)) {
      return;
    }
    if (!latestPlayback?.tracks.length) {
      throw new Error('No audio to replay yet.');
    }
    await playTracksInCursor(context, latestPlayback.tracks);
  });
  register('vartermCursor.jumpBack', async () => {
    await jumpPlayback(-1);
  });
  register('vartermCursor.jumpForward', async () => {
    await jumpPlayback(1);
  });
  register('vartermCursor.statusBarAction', () => handleStatusBarAction(context));
  register('vartermCursor.toggleAutoRead', () => toggleAutoRead(context));
  register('vartermCursor.saveLastAudio', () => saveLatestAudio());

  void snapshotClipboard();
  void pruneAudioCache(context);
  void maybeShowShortcutsTip(context);
  void maybeShowAutoReadTip(context);
  if (getAutoReadEnabled(context)) {
    void setAutoReadEnabled(context, true, { persistSettings: false });
  }
}

export function deactivate(): void {
  autoReadWatcher?.dispose();
  playbackLockWatcher?.dispose();
  stopIndicatorAnimation();
  stopHostPlayback();
  releasePlayback();
}
