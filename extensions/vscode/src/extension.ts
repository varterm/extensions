import * as vscode from 'vscode';
import { createTtsHttpClient } from '@varterm/tts-client';

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
  readAloudVoice: string;
  readAloudRate: number;
  readAloudProvider: 'edge' | 'premium';
  maxCachedAudioFiles: number;
};

let audioPanel: vscode.WebviewPanel | undefined;
let lastEditorColumn: vscode.ViewColumn = vscode.ViewColumn.One;
let isGeneratingAudio = false;
let latestAudioFileUri: vscode.Uri | undefined;
let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Varterm TTS');
  }
  return outputChannel;
}

function logInfo(message: string): void {
  getOutputChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
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
    readAloudVoice: config.get<string>('readAloudVoice', 'en-US-AriaNeural'),
    readAloudRate: config.get<number>('readAloudRate', 1),
    readAloudProvider: config.get<'edge' | 'premium'>('readAloudProvider', 'edge'),
    maxCachedAudioFiles: config.get<number>('maxCachedAudioFiles', 20),
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
    vscode.window.showWarningMessage('Varterm is already generating audio. Please wait.');
    return;
  }

  const settings = getSettings();
  const normalized = text.trim();
  if (!normalized) {
    throw new Error('No text available to read aloud.');
  }

  showAudioLoadingPanel(context, label);
  isGeneratingAudio = true;

  try {
    const selectedVoiceId = context.globalState.get<string>(VOICE_ID_KEY) || settings.readAloudVoice;
    const selectedProvider =
      context.globalState.get<'edge' | 'premium'>(VOICE_PROVIDER_KEY) || settings.readAloudProvider;

    // Keep chunks smaller for cloud generation to avoid long single-request timeouts.
    const maxCharsPerTrack = selectedProvider === 'premium' ? 4500 : 12000;
    const chunks = splitTextIntoChunks(normalized, maxCharsPerTrack);
    logInfo(`Using provider=${selectedProvider}, chunks=${chunks.length}`);

    const tracks: Array<{ title: string; base64: string }> = [];
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
        audioBytes = await postBinary(context, endpoint, payload);
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
        audioBytes = await postBinary(context, endpoint, payload);

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

    const outputDir = vscode.Uri.joinPath(context.globalStorageUri, 'audio');
    await vscode.workspace.fs.createDirectory(outputDir);
    await pruneAudioCache(context, outputDir, settings.maxCachedAudioFiles);
    const fileName = `varterm-${Date.now()}-part1.mp3`;
    const outputFile = vscode.Uri.joinPath(outputDir, fileName);
    await vscode.workspace.fs.writeFile(outputFile, Buffer.from(tracks[0].base64, 'base64'));
    latestAudioFileUri = outputFile;
    showAudioPanel(context, tracks, label, {
      voiceId: selectedVoiceId,
      voiceName: context.globalState.get<string>(VOICE_NAME_KEY) || selectedVoiceId,
      provider: selectedProvider,
      rate: settings.readAloudRate,
    });
    const action = await vscode.window.showInformationMessage(
      `Varterm audio ready (${label}). Playing in editor.`,
      'Open in default player',
      'Reveal audio file'
    );

    if (action === 'Open in default player') {
      if (latestAudioFileUri) {
        await vscode.env.openExternal(latestAudioFileUri);
      }
    } else if (action === 'Reveal audio file') {
      if (latestAudioFileUri) {
        await vscode.commands.executeCommand('revealFileInOS', latestAudioFileUri);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logInfo(`readTextAloud error: ${message}`);
    showAudioErrorPanel(context, label, message);
    throw error;
  } finally {
    isGeneratingAudio = false;
  }
}

async function pruneAudioCache(
  context: vscode.ExtensionContext,
  outputDir: vscode.Uri,
  maxFiles: number
): Promise<void> {
  const safeMaxFiles = Math.max(1, Math.min(200, maxFiles));
  const entries = await vscode.workspace.fs.readDirectory(outputDir);
  const audioEntries = entries.filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.mp3'));

  if (audioEntries.length <= safeMaxFiles) {
    return;
  }

  const withStats = await Promise.all(
    audioEntries.map(async ([name]) => {
      const uri = vscode.Uri.joinPath(outputDir, name);
      const stat = await vscode.workspace.fs.stat(uri);
      return { uri, mtime: stat.mtime };
    })
  );

  withStats.sort((a, b) => b.mtime - a.mtime);
  const stale = withStats.slice(safeMaxFiles);
  await Promise.all(stale.map(async (file) => vscode.workspace.fs.delete(file.uri)));
}

async function clearAudioCache(context: vscode.ExtensionContext): Promise<void> {
  const outputDir = vscode.Uri.joinPath(context.globalStorageUri, 'audio');
  try {
    const entries = await vscode.workspace.fs.readDirectory(outputDir);
    const audioEntries = entries.filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.mp3'));
    await Promise.all(
      audioEntries.map(async ([name]) => vscode.workspace.fs.delete(vscode.Uri.joinPath(outputDir, name)))
    );
    vscode.window.showInformationMessage(`Cleared ${audioEntries.length} cached audio file(s).`);
  } catch {
    vscode.window.showInformationMessage('No cached audio files found.');
  }
}

async function openSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', 'vartermCursor');
}

function showAudioPanel(
  context: vscode.ExtensionContext,
  tracks: Array<{ title: string; base64: string }>,
  label: string,
  playback: { voiceId: string; voiceName: string; provider: 'edge' | 'premium'; rate: number }
): void {
  const tracksJson = JSON.stringify(tracks);
  const panel = ensureAudioPanel(context);
  panel.reveal(vscode.ViewColumn.Beside, false);

  panel.title = `Varterm Audio (${label})`;
  panel.webview.html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Varterm Audio</title>
    <style>
      body { font-family: sans-serif; padding: 8px 12px; color: #f4f4f5; background: #0a0a0b; }
      .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .title { font-size: 13px; opacity: 0.9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .meta { font-size: 12px; opacity: 0.7; }
      .status { font-size: 11px; opacity: 0.7; margin-top: 6px; min-height: 14px; }
      audio { width: 100%; margin-top: 8px; height: 28px; }
      select { width: 100%; margin-top: 8px; background: #121214; color: #f4f4f5; border: 1px solid #2a2a2e; border-radius: 4px; padding: 4px; }
      .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
      .controls button, .controls select, .controls input {
        background: #121214; color: #f4f4f5; border: 1px solid #2a2a2e; border-radius: 4px; padding: 4px;
        min-height: 30px; box-sizing: border-box;
      }
      .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
      .actions button {
        background: #103a35; color: #eafff8; border: 1px solid #1e6f62; border-radius: 4px; padding: 6px;
        font-size: 12px; min-height: 30px; box-sizing: border-box;
      }
      .actions button:hover { background: #145248; }
    </style>
  </head>
  <body>
    <div class="row">
      <div class="title">Varterm Read Aloud</div>
      <div class="meta" id="partMeta"></div>
    </div>
    <div class="meta">${escapeHtml(label)}</div>
    <div class="controls">
      <select id="providerSelect">
        <option value="edge">Edge (free)</option>
        <option value="premium">Premium (ElevenLabs API key needed)</option>
      </select>
      <button id="changeVoiceBtn" type="button">Voice: ${escapeHtml(playback.voiceName)}</button>
    </div>
    <select id="trackSelect"></select>
    <div class="actions">
      <button id="readClipboardBtn" type="button">Read Clipboard</button>
      <button id="readEditorBtn" type="button">Read Editor/Selection</button>
      <button id="openSettingsBtn" type="button">Open Settings</button>
      <button id="clearCacheBtn" type="button">Clear Audio Cache</button>
    </div>
    <audio id="player" controls autoplay></audio>
    <div id="status" class="status"></div>
    <script>
      const tracks = ${tracksJson};
      const player = document.getElementById('player');
      const select = document.getElementById('trackSelect');
      const partMeta = document.getElementById('partMeta');
      const providerSelect = document.getElementById('providerSelect');
      const changeVoiceBtn = document.getElementById('changeVoiceBtn');
      const readClipboardBtn = document.getElementById('readClipboardBtn');
      const readEditorBtn = document.getElementById('readEditorBtn');
      const openSettingsBtn = document.getElementById('openSettingsBtn');
      const clearCacheBtn = document.getElementById('clearCacheBtn');
      const vscodeApi = acquireVsCodeApi();
      const statusEl = document.getElementById('status');
      let autoPlayInProgress = false;
      let objectUrls = [];

      function toObjectUrl(base64Audio) {
        const binary = atob(base64Audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        return url;
      }

      function clearObjectUrls() {
        for (const url of objectUrls) {
          URL.revokeObjectURL(url);
        }
        objectUrls = [];
      }

      function renderOptions() {
        if (tracks.length <= 1) {
          select.style.display = 'none';
          return;
        }
        select.style.display = 'block';
        select.innerHTML = tracks.map((t, i) => '<option value="' + i + '">' + t.title + '</option>').join('');
      }

      function loadTrack(index) {
        const track = tracks[index];
        if (!track) return;
        // Blob URLs are more reliable than large data: URIs in webviews.
        player.src = toObjectUrl(track.base64);
        partMeta.textContent = (index + 1) + '/' + tracks.length;
        select.value = String(index);
        tryAutoPlay();
      }

      async function tryAutoPlay() {
        if (autoPlayInProgress) {
          return;
        }
        autoPlayInProgress = true;
        statusEl.textContent = 'Starting playback...';
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            player.muted = true;
            player.autoplay = true;
            if (attempt === 0) {
              player.load();
            }
            await player.play();
            setTimeout(() => { player.muted = false; }, 220);
            statusEl.textContent = '';
            autoPlayInProgress = false;
            return;
          } catch (e) {
            await new Promise((resolve) => setTimeout(resolve, 180));
          }
        }
        player.muted = false;
        statusEl.textContent = 'Autoplay blocked. Press play once to enable.';
        vscodeApi.postMessage({ type: 'autoplayBlocked' });
        autoPlayInProgress = false;
      }

      select.addEventListener('change', () => {
        loadTrack(Number(select.value));
      });

      player.addEventListener('ended', () => {
        const current = Number(select.value);
        if (current + 1 < tracks.length) {
          loadTrack(current + 1);
        }
      });

      player.addEventListener('play', () => {
        statusEl.textContent = '';
      });
      player.addEventListener('error', () => {
        const mediaError = player.error;
        const code = mediaError ? mediaError.code : 'unknown';
        statusEl.textContent = 'Playback failed. Use "Open in default player" or try again.';
        vscodeApi.postMessage({
          type: 'playerError',
          detail: 'HTML audio playback error (code: ' + code + ')'
        });
      });

      providerSelect.value = '${playback.provider}';
      providerSelect.addEventListener('change', () => {
        vscodeApi.postMessage({ type: 'setProvider', value: providerSelect.value });
      });
      changeVoiceBtn.addEventListener('click', () => {
        vscodeApi.postMessage({ type: 'changeVoice' });
      });
      readClipboardBtn.addEventListener('click', () => {
        vscodeApi.postMessage({ type: 'runCommand', command: 'vartermCursor.readClipboardAloud' });
      });
      readEditorBtn.addEventListener('click', () => {
        vscodeApi.postMessage({ type: 'runCommand', command: 'vartermCursor.readEditorAloud' });
      });
      openSettingsBtn.addEventListener('click', () => {
        vscodeApi.postMessage({ type: 'runCommand', command: 'vartermCursor.openSettings' });
      });
      clearCacheBtn.addEventListener('click', () => {
        vscodeApi.postMessage({ type: 'runCommand', command: 'vartermCursor.clearAudioCache' });
      });
      window.addEventListener('message', (event) => {
        if (event?.data?.type === 'attemptAutoplay') {
          if (player.paused) {
            tryAutoPlay();
          }
        }
      });
      window.addEventListener('beforeunload', () => {
        clearObjectUrls();
      });

      renderOptions();
      loadTrack(0);
    </script>
  </body>
</html>`;
}

function showAudioLoadingPanel(context: vscode.ExtensionContext, label: string): void {
  const panel = ensureAudioPanel(context);
  panel.reveal(vscode.ViewColumn.Beside, false);
  panel.title = `Varterm Audio (${label})`;
  panel.webview.html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: sans-serif; padding: 12px; color: #f4f4f5; background: #0a0a0b; }
      .status { font-size: 13px; opacity: 0.9; }
      .meta { margin-top: 6px; font-size: 12px; opacity: 0.75; }
    </style>
  </head>
  <body>
    <div class="status">Preparing audio...</div>
    <div class="meta">${escapeHtml(label)}</div>
  </body>
</html>`;
}

function showAudioErrorPanel(context: vscode.ExtensionContext, label: string, message: string): void {
  const panel = ensureAudioPanel(context);
  panel.reveal(vscode.ViewColumn.Beside, false);
  panel.title = `Varterm Audio (${label})`;
  panel.webview.html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: sans-serif; padding: 12px; color: #f4f4f5; background: #0a0a0b; }
      .status { font-size: 13px; color: #ff9b9b; }
      .meta { margin-top: 6px; font-size: 12px; opacity: 0.8; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <div class="status">Audio generation failed</div>
    <div class="meta">${escapeHtml(message)}</div>
  </body>
</html>`;
}

function ensureAudioPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
  if (!audioPanel) {
    audioPanel = vscode.window.createWebviewPanel(
      'vartermAudioPlayer',
      'Varterm Audio',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    audioPanel.onDidDispose(() => {
      audioPanel = undefined;
    });
    audioPanel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) {
        event.webviewPanel.webview.postMessage({ type: 'attemptAutoplay' });
      }
    });
    audioPanel.webview.onDidReceiveMessage(async (message) => {
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

      if (message?.type === 'setRate') {
        const nextRate = Number(message.value);
        const safeRate = Math.max(0.5, Math.min(2, Number.isFinite(nextRate) ? nextRate : 1));
        await vscode.workspace
          .getConfiguration('vartermCursor')
          .update('readAloudRate', safeRate, vscode.ConfigurationTarget.Global);
        return;
      }

      if (message?.type === 'runCommand' && typeof message.command === 'string') {
        await vscode.commands.executeCommand(message.command);
        return;
      }

      if (message?.type === 'autoplayBlocked') {
        logInfo('Webview autoplay blocked');
        vscode.window.showWarningMessage('Autoplay was blocked. Press play once in the editor player.');
        return;
      }

      if (message?.type === 'playerError' && typeof message.detail === 'string') {
        logInfo(`Webview player error: ${message.detail}`);
        vscode.window.showErrorMessage(`Varterm player error: ${message.detail}`);
      }
    });
  }
  audioPanel.reveal(vscode.ViewColumn.Beside, false);
  return audioPanel;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

  const manual = await vscode.window.showInputBox({
    title: 'Varterm Read Aloud',
    prompt: 'No editor/clipboard text found. Paste text to read aloud.',
    ignoreFocusOut: true,
    value: '',
  });
  if (!manual || !manual.trim()) {
    throw new Error('No text provided to read aloud.');
  }

  await readTextAloud(context, manual.trim(), 'manual input');
}

async function readClipboardAloud(context: vscode.ExtensionContext): Promise<void> {
  const clipboard = (await vscode.env.clipboard.readText()).trim();
  if (clipboard) {
    await readTextAloud(context, clipboard, 'clipboard');
    return;
  }

  const manual = await vscode.window.showInputBox({
    title: 'Varterm Read Clipboard Aloud',
    prompt: 'Clipboard is empty. Paste text to read aloud.',
    ignoreFocusOut: true,
    value: '',
  });
  if (!manual || !manual.trim()) {
    throw new Error('Clipboard is empty and no manual text was provided.');
  }

  await readTextAloud(context, manual.trim(), 'manual input');
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.viewColumn) {
        lastEditorColumn = editor.viewColumn;
      }
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
  register('vartermCursor.clearAudioCache', () => clearAudioCache(context));
}

export function deactivate(): void {
  // No-op.
}
