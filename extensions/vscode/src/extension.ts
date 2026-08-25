import { spawn, type ChildProcess } from 'node:child_process';
import * as vscode from 'vscode';
import { createTtsHttpClient } from '@varterm/tts-client';
import { PLAYER_VIEW_ID, VartermPlayerViewProvider } from './player-view';
import {
  AUTO_READ_KEY,
  getAutoReadEnabled,
  installVartermAgentHook,
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
let playbackState: 'idle' | 'generating' | 'playing' = 'idle';
let statusBar: vscode.StatusBarItem | undefined;
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

function setPlaybackStatus(text: string, state: typeof playbackState = playbackState): void {
  playbackState = state;
  if (!statusBar) {
    return;
  }
  statusBar.text = text;
  statusBar.command = 'vartermCursor.statusBarAction';
  statusBar.tooltip =
    state === 'playing'
      ? 'Click to stop'
      : state === 'generating'
        ? 'Click to cancel'
        : latestPlayback
          ? 'Click to play last audio again'
          : 'Click to read clipboard';
  statusBar.show();
}

function setIdleStatus(): void {
  setPlaybackStatus(latestPlayback ? '$(play) Varterm replay' : '$(play) Varterm', 'idle');
}

function setAutoReadStatus(enabled: boolean): void {
  if (!autoReadStatusBar) {
    return;
  }
  autoReadStatusBar.text = enabled ? '$(broadcast) Auto-read on' : '$(circle-slash) Auto-read off';
  autoReadStatusBar.tooltip = enabled
    ? 'Varterm will read new assistant replies when they finish. Click to turn off.'
    : 'Click to auto-read new assistant replies when they finish.';
  autoReadStatusBar.show();
}

async function setAutoReadEnabled(context: vscode.ExtensionContext, enabled: boolean): Promise<void> {
  await context.globalState.update(AUTO_READ_KEY, enabled);
  await vscode.workspace
    .getConfiguration('vartermCursor')
    .update('autoReadAgentOutput', enabled, vscode.ConfigurationTarget.Global);
  setAutoReadStatus(enabled);

  autoReadWatcher?.dispose();
  autoReadWatcher = undefined;

  if (!enabled) {
    logInfo('Auto-read off');
    return;
  }

  await installVartermAgentHook(context.extensionPath);
  autoReadWatcher = watchAgentDropFile((text) => {
    stopHostPlayback();
    void readTextAloud(context, text, 'agent').catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Varterm auto-read: ${message}`);
    });
  }, logInfo);
  logInfo('Auto-read on');
}

async function toggleAutoRead(context: vscode.ExtensionContext): Promise<void> {
  const next = !getAutoReadEnabled(context);
  await setAutoReadEnabled(context, next);
  vscode.window.showInformationMessage(
    next
      ? 'Varterm auto-read is on. New assistant replies will play when they finish.'
      : 'Varterm auto-read is off.'
  );
}

function stopHostPlayback(): void {
  if (!playbackProcess) {
    return;
  }
  const child = playbackProcess;
  playbackProcess = undefined;
  try {
    child.kill('SIGTERM');
  } catch {
    // Already exited.
  }
}

async function playTracksInCursor(context: vscode.ExtensionContext, tracks: AudioTrack[]): Promise<void> {
  stopHostPlayback();
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

  setPlaybackStatus('$(unmute) Varterm playing — click to stop', 'playing');
  logInfo(`Playing ${files.length} track(s) with /usr/bin/afplay`);

  try {
    await playFilesWithAfplay(files);
  } finally {
    if (playbackState === 'playing') {
      setIdleStatus();
    }
    void pruneAudioCache(context);
  }
}

function playFilesWithAfplay(files: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let index = 0;

    const playNext = (): void => {
      if (index >= files.length) {
        playbackProcess = undefined;
        resolve();
        return;
      }

      const filePath = files[index];
      index += 1;
      const child = spawn('/usr/bin/afplay', [filePath], {
        stdio: 'ignore',
        env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      });
      playbackProcess = child;

      child.on('error', (error) => {
        if (playbackProcess === child) {
          playbackProcess = undefined;
        }
        reject(error);
      });

      child.on('close', (code) => {
        if (playbackProcess !== child) {
          resolve();
          return;
        }
        if (code && code !== 0) {
          playbackProcess = undefined;
          reject(new Error(`afplay exited with code ${code}`));
          return;
        }
        playNext();
      });
    };

    playNext();
  });
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
  label: string
): Promise<void> {
  logInfo(`readTextAloud start: label=${label}, chars=${text.length}`);
  if (isGeneratingAudio) {
    const choice = await vscode.window.showWarningMessage(
      'Varterm is still generating audio.',
      'Cancel and start over',
      'Wait'
    );
    if (choice !== 'Cancel and start over') {
      return;
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
  setPlaybackStatus('$(loading~spin) Varterm generating…', 'generating');
  playerProvider?.post({ type: 'loading', label });

  try {
    const selectedVoiceId = context.globalState.get<string>(VOICE_ID_KEY) || settings.readAloudVoice;
    const selectedProvider =
      context.globalState.get<'edge' | 'premium'>(VOICE_PROVIDER_KEY) || settings.readAloudProvider;

    // Keep chunks smaller for cloud generation to avoid long single-request timeouts.
    const maxCharsPerTrack = selectedProvider === 'premium' ? 4500 : 12000;
    const chunks = splitTextIntoChunks(normalized, maxCharsPerTrack);
    logInfo(`Using provider=${selectedProvider}, chunks=${chunks.length}`);

    const tracks: AudioTrack[] = [];
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

      tracks.push({
        title: chunks.length === 1 ? label : `${label} (part ${i + 1}/${chunks.length})`,
        base64: Buffer.from(audioBytes).toString('base64'),
      });
    }
    logInfo(`Generated audio tracks: ${tracks.length}`);

    latestPlayback = { tracks, label };
    playerProvider?.post({
      type: 'ready',
      tracks,
      label,
      voiceName: context.globalState.get<string>(VOICE_NAME_KEY) || selectedVoiceId,
      provider: selectedProvider,
    });
    isGeneratingAudio = false;
    await playTracksInCursor(context, tracks);
  } catch (error) {
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
          await vscode.workspace
            .getConfiguration('vartermCursor')
            .update('readAloudProvider', provider, vscode.ConfigurationTarget.Global);
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
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    let slice = text.slice(start, end);
    if (end < text.length) {
      const breakIndex = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '), slice.lastIndexOf(' '));
      if (breakIndex > Math.floor(maxChars * 0.5)) {
        slice = slice.slice(0, breakIndex + 1);
      }
    }
    const finalChunk = slice.trim();
    if (finalChunk) {
      chunks.push(finalChunk);
    }
    start += Math.max(1, slice.length);
  }
  return chunks;
}

async function handleStatusBarAction(context: vscode.ExtensionContext): Promise<void> {
  if (playbackState === 'playing') {
    stopHostPlayback();
    setIdleStatus();
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

  if (latestPlayback?.tracks.length) {
    await playTracksInCursor(context, latestPlayback.tracks);
    return;
  }

  await readClipboardAloud(context);
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
  register('vartermCursor.openSettings', () => openSettings());
  register('vartermCursor.openKeyboardShortcuts', () => openKeyboardShortcuts());
  register('vartermCursor.clearAudioCache', () => clearAudioCache(context));
  register('vartermCursor.stopPlayback', async () => {
    stopHostPlayback();
    setIdleStatus();
  });
  register('vartermCursor.statusBarAction', () => handleStatusBarAction(context));
  register('vartermCursor.toggleAutoRead', () => toggleAutoRead(context));
  register('vartermCursor.saveLastAudio', () => saveLatestAudio());

  void pruneAudioCache(context);
  void maybeShowShortcutsTip(context);
  if (getAutoReadEnabled(context) || getSettings().autoReadAgentOutput) {
    void setAutoReadEnabled(context, true);
  }
}

export function deactivate(): void {
  autoReadWatcher?.dispose();
  stopHostPlayback();
}
