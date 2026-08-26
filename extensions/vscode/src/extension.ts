import { spawn, type ChildProcess } from 'node:child_process';
import * as vscode from 'vscode';
import { createTtsHttpClient } from '@varterm/tts-client';
import { PLAYER_VIEW_ID, VartermPlayerViewProvider } from './player-view';
import {
  AUTO_READ_KEY,
  getAutoReadEnabled,
  installVartermAgentHook,
  readLastAgentText,
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
};

type AudioTrack = { title: string; base64: string };

let isGeneratingAudio = false;
let generationCts: vscode.CancellationTokenSource | undefined;
let latestPlayback: { tracks: AudioTrack[]; label: string } | undefined;
let playerProvider: VartermPlayerViewProvider | undefined;
let playbackProcess: ChildProcess | undefined;
const livePlayers = new Set<ChildProcess>();
const stoppedPlayers = new WeakSet<ChildProcess>();
let playbackState: 'idle' | 'generating' | 'playing' | 'paused' = 'idle';
let playbackFiles: string[] = [];
let playbackIndex = 0;
let playGeneration = 0;
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
let autoReadWatcher: { dispose: () => void } | undefined;
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
    } else {
      statusBar.text = '$(play)';
      statusBar.tooltip = 'Play';
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
}

function setPlaybackStatus(_text: string, state: typeof playbackState = playbackState): void {
  playbackState = state;
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
    ? 'On: when an assistant reply finishes, Varterm reads it. Click to turn off.'
    : 'Off: click to auto-read assistant replies when they finish.';
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
  options?: { persistSettings?: boolean }
): Promise<void> {
  await context.globalState.update(AUTO_READ_KEY, enabled);
  if (options?.persistSettings !== false) {
    await tryUpdateUserSetting('autoReadAgentOutput', enabled);
  }
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
  autoReadWatcher = watchAgentDropFile((text) => {
    void readTextAloud(context, text, 'agent reply', { replace: true }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Varterm auto-read: ${message}`);
    });
  }, logInfo);
  logInfo('Auto-read on');
}

async function toggleAutoRead(context: vscode.ExtensionContext): Promise<void> {
  const next = !getAutoReadEnabled(context);
  await setAutoReadEnabled(context, next);
  vscode.window.showInformationMessage(next ? 'Auto-read on. Finished replies will play.' : 'Auto-read off.');
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

function stopHostPlayback(): void {
  playGeneration += 1;
  waitingForChunk = undefined;
  killPlaybackProcess();
  playResolve?.();
  playResolve = undefined;
  playReject = undefined;
}

function pauseHostPlayback(): boolean {
  if (!playbackProcess || playbackState !== 'playing') {
    return false;
  }
  try {
    playbackProcess.kill('SIGSTOP');
  } catch {
    return false;
  }
  setPlaybackStatus('$(play)', 'paused');
  return true;
}

function resumeHostPlayback(): boolean {
  if (!playbackProcess || playbackState !== 'paused') {
    return false;
  }
  try {
    playbackProcess.kill('SIGCONT');
  } catch {
    return false;
  }
  setPlaybackStatus('$(debug-pause)', 'playing');
  return true;
}

async function playTracksInCursor(
  context: vscode.ExtensionContext,
  tracks: AudioTrack[],
  startIndex = 0
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
    await playFilesWithAfplay(files, startIndex);
  } finally {
    if (
      (playbackState === 'playing' || playbackState === 'paused') &&
      playbackFiles === files
    ) {
      setIdleStatus();
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

function startChunk(index: number, generation: number): void {
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
    return;
  }
  waitingForChunk = undefined;
  playbackIndex = Math.max(0, index);
  refreshTransport();
  const filePath = playbackFiles[playbackIndex];
  logInfo(`Start chunk ${playbackIndex + 1}/${expectedTrackCount || playbackFiles.length} ${filePath}`);
  const child = spawn('/usr/bin/afplay', [filePath], {
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

function playFilesWithAfplay(files: string[], startIndex = 0): Promise<void> {
  playGeneration += 1;
  const generation = playGeneration;
  playbackFiles = files;
  return new Promise((resolve, reject) => {
    playResolve = resolve;
    playReject = reject;
    startChunk(Math.max(0, Math.min(startIndex, files.length - 1)), generation);
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

async function selectReadAloudVoice(context: vscode.ExtensionContext): Promise<void> {
  const voices = await fetchVoices(context);
  if (!voices.length) {
    throw new Error('No voices available. Check your API base URL and try again.');
  }

  const picked = await vscode.window.showQuickPick(
    voices.map((voice) => ({
      label: voice.label,
      description: `${voice.provider.toUpperCase()} • ${voice.description}`,
      voice,
    })),
    { placeHolder: 'Select a read-aloud voice' }
  );

  if (!picked) {
    return;
  }

  await context.globalState.update(VOICE_ID_KEY, picked.voice.id);
  await context.globalState.update(VOICE_NAME_KEY, picked.voice.label);
  await context.globalState.update(VOICE_PROVIDER_KEY, picked.voice.provider);

  vscode.window.showInformationMessage(`Varterm voice selected: ${picked.voice.label}`);
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
    await readTextAloud(context, response.result.answer, 'answer');
  }

  await maybeOpenSourceFromAnswer(response.result.sources);
}

async function readTextAloud(
  context: vscode.ExtensionContext,
  text: string,
  label: string,
  options?: { replace?: boolean }
): Promise<void> {
  logInfo(`readTextAloud start: label=${label}, chars=${text.length}`);
  if (isGeneratingAudio) {
    if (!options?.replace) {
      const choice = await vscode.window.showWarningMessage(
        'Varterm is still generating audio.',
        'Cancel and start over',
        'Wait'
      );
      if (choice !== 'Cancel and start over') {
        return;
      }
    }
    generationCts?.cancel();
    generationCts?.dispose();
    generationCts = undefined;
    isGeneratingAudio = false;
  }

  const settings = getSettings();
  const normalized = text.trim();
  if (!normalized) {
    throw new Error('No text available to read aloud.');
  }

  stopHostPlayback();
  isGeneratingAudio = true;
  generationCts = new vscode.CancellationTokenSource();
  const token = generationCts.token;
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
          ? { text: chunkText, voiceId: voiceToUse, speed: settings.readAloudRate }
          : { text: chunkText, voice: voiceToUse, rate: settings.readAloudRate };

      let audioBytes: Uint8Array;
      try {
        if (token.isCancellationRequested) {
          throw new Error('Cancelled');
        }
        audioBytes = await postBinary(context, endpoint, payload, { cancellationToken: token });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const premiumKeyMissing =
          providerToUse === 'premium' && /ELEVENLABS_API_KEY|ElevenLabs/i.test(message);
        if (!premiumKeyMissing) {
          throw error;
        }

        providerToUse = 'edge';
        voiceToUse = 'en-US-AriaNeural';
        endpoint = '/api/edge-tts';
        payload = { text: chunkText, voice: voiceToUse, rate: settings.readAloudRate };
        audioBytes = await postBinary(context, endpoint, payload, { cancellationToken: token });

        await context.globalState.update(VOICE_PROVIDER_KEY, providerToUse);
        await context.globalState.update(VOICE_ID_KEY, voiceToUse);
        await context.globalState.update(VOICE_NAME_KEY, 'Aria (en-US-AriaNeural)');
        vscode.window.showWarningMessage(
          'Premium voice requires ELEVENLABS_API_KEY. Switched to Edge voice (Aria).'
        );
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
      latestPlayback = { tracks: tracks.slice(), label };
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
      } else {
        refreshTransport();
      }
    }
    logInfo(`Generated audio tracks: ${tracks.length}`);

    playerProvider?.post({
      type: 'ready',
      tracks,
      label,
      voiceName: context.globalState.get<string>(VOICE_NAME_KEY) || selectedVoiceId,
      provider: selectedProvider,
    });
    isGeneratingAudio = false;
    if (playDone) {
      try {
        await playDone;
      } finally {
        if (
          (playbackState === 'playing' || playbackState === 'paused') &&
          playbackFiles === files
        ) {
          setIdleStatus();
        }
        void pruneAudioCache(context);
      }
    }
  } catch (error) {
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
    isGeneratingAudio = false;
    generationCts?.dispose();
    generationCts = undefined;
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

  const clipboard = getShortcutLabel('readClipboardAloud');
  const choice = await vscode.window.showInformationMessage(
    `Varterm: Copy text, then press ${clipboard} to hear it aloud.`,
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
  vscode.window.showWarningMessage('Nothing to read. Copy text, then press the Varterm shortcut again.');
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
          await readTextAloud(context, message.text, 'pasted');
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
    generationCts?.cancel();
    generationCts?.dispose();
    generationCts = undefined;
    isGeneratingAudio = false;
    setIdleStatus();
    return;
  }

  const editor = vscode.window.activeTextEditor;
  const selected = editor?.document.getText(editor.selection).trim() || '';
  if (selected) {
    await readTextAloud(context, selected, 'selection');
    return;
  }

  if (latestPlayback?.tracks.length) {
    await playTracksInCursor(context, latestPlayback.tracks);
    return;
  }

  const lastAgent = readLastAgentText();
  if (lastAgent) {
    await readTextAloud(context, lastAgent, 'agent reply');
    return;
  }

  await readClipboardAloud(context);
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
  const selected = editor?.document.getText(editor.selection).trim() || '';
  const fallback = editor?.document.getText().trim() || '';
  const text = selected || fallback;

  if (text) {
    await readTextAloud(context, text, selected ? 'selection' : 'document');
    return;
  }

  const clipboard = (await vscode.env.clipboard.readText()).trim();
  if (clipboard) {
    await readTextAloud(context, clipboard, 'clipboard');
    return;
  }

  showPlayerNeedText();
}

async function readClipboardAloud(context: vscode.ExtensionContext): Promise<void> {
  const clipboard = (await vscode.env.clipboard.readText()).trim();
  if (clipboard) {
    await readTextAloud(context, clipboard, 'clipboard');
    return;
  }

  showPlayerNeedText();
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  statusBar.show();
  context.subscriptions.push(statusBar);
  setIdleStatus();

  autoReadStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 79);
  autoReadStatusBar.command = 'vartermCursor.toggleAutoRead';
  context.subscriptions.push(autoReadStatusBar);
  setAutoReadStatus(getAutoReadEnabled(context) || getSettings().autoReadAgentOutput);

  jumpBackBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 81);
  jumpBackBar.command = 'vartermCursor.jumpBack';
  context.subscriptions.push(jumpBackBar);

  stopStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 78);
  stopStatusBar.command = 'vartermCursor.stopPlayback';
  context.subscriptions.push(stopStatusBar);

  jumpForwardBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 77);
  jumpForwardBar.command = 'vartermCursor.jumpForward';
  context.subscriptions.push(jumpForwardBar);

  replayBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 76);
  replayBar.command = 'vartermCursor.replayLast';
  context.subscriptions.push(replayBar);
  refreshTransport();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('vartermCursor.autoReadAgentOutput')) {
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
          const message = error instanceof Error ? error.message : 'Unexpected error';
          vscode.window.showErrorMessage(`Varterm: ${message}`);
        }
      })
    );
  };

  register('vartermCursor.connect', () => connect(context));
  register('vartermCursor.setElevenLabsApiKey', () => setElevenLabsApiKey(context));
  register('vartermCursor.selectReadAloudVoice', () => selectReadAloudVoice(context));
  register('vartermCursor.readEditorAloud', () => readEditorAloud(context));
  register('vartermCursor.readClipboardAloud', () => readClipboardAloud(context));
  register('vartermCursor.readLastAgentReply', async () => {
    const text = readLastAgentText();
    if (!text) {
      throw new Error('No agent reply captured yet. Leave Auto-read on and wait for a reply to finish.');
    }
    await readTextAloud(context, text, 'agent reply');
  });
  register('vartermCursor.openSettings', () => openSettings());
  register('vartermCursor.openKeyboardShortcuts', () => openKeyboardShortcuts());
  register('vartermCursor.clearAudioCache', () => clearAudioCache(context));
  register('vartermCursor.stopPlayback', async () => {
    stopHostPlayback();
    setIdleStatus();
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

  void pruneAudioCache(context);
  void maybeShowShortcutsTip(context);
  void maybeShowAutoReadTip(context);
  if (getAutoReadEnabled(context) || getSettings().autoReadAgentOutput) {
    void setAutoReadEnabled(context, true, { persistSettings: false });
  }
}

export function deactivate(): void {
  autoReadWatcher?.dispose();
  stopHostPlayback();
}
