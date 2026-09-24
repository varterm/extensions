import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  autoReadClaimDelayMs,
  chooseFocusedComposerId,
  dropBelongsToRoots,
  dropForConversation,
  lastAssistantTextFromTranscript,
  newestOwnedDrop,
} from './agent-drop';

const nodeRequire = createRequire(__filename);

export const AUTO_READ_KEY = 'vartermCursor.autoReadAgentOutput';
const RELATIVE_HOOK_COMMAND = './hooks/varterm-autoread.py';
const STORE_NAME = 'varterm-autoread.json';

type AgentDrop = {
  text?: string;
  ts?: number;
  cwd?: string;
  workspace?: string;
  conversationId?: string;
};
type AutoReadStore = {
  enabled?: boolean;
  agentsWindow?: boolean;
  workspaces?: Record<string, boolean>;
};

/** This extension host / window only. Do not read settings here. */
let thisWindowEnabled = false;

export function getAutoReadEnabled(_context?: vscode.ExtensionContext): boolean {
  return thisWindowEnabled;
}

/** Cursor's Agents window (Glass) sets this on the extension API. Editor windows do not. */
export function windowIsAgentsWindow(): boolean {
  const cursorApi = (vscode as unknown as { cursor?: { isGlass?: boolean } }).cursor;
  return cursorApi?.isGlass === true;
}

export function getAgentsWindowAutoRead(): boolean {
  return readAutoReadStore().agentsWindow === true;
}

export function persistAgentsWindowAutoRead(enabled: boolean): void {
  const store = readAutoReadStore();
  store.agentsWindow = enabled;
  writeAutoReadStore(store);
}

function autoReadStorePath(): string {
  return path.join(os.homedir(), '.cursor', STORE_NAME);
}

function workspacePersistKey(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return '__empty__';
  }
  return folders
    .map((folder) => folder.uri.fsPath)
    .sort()
    .join('\n');
}

function readAutoReadStore(): AutoReadStore {
  try {
    return JSON.parse(fs.readFileSync(autoReadStorePath(), 'utf8')) as AutoReadStore;
  } catch {
    return {};
  }
}

function writeAutoReadStore(store: AutoReadStore): void {
  fs.mkdirSync(path.dirname(autoReadStorePath()), { recursive: true });
  fs.writeFileSync(autoReadStorePath(), `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function readDurableAutoRead(workspaceKey: string): boolean | undefined {
  const store = readAutoReadStore();
  // A global Off wins over a leftover per-workspace On from another folder.
  if (store.enabled === false) {
    return false;
  }
  const byWorkspace = store.workspaces?.[workspaceKey];
  if (typeof byWorkspace === 'boolean') {
    return byWorkspace;
  }
  if (typeof store.enabled === 'boolean') {
    return store.enabled;
  }
  return undefined;
}

/** Memory and the on-disk file. Other windows / a stale watcher must both be off. */
export function isAutoReadAllowed(): boolean {
  if (!thisWindowEnabled) {
    return false;
  }
  return readAutoReadStore().enabled !== false;
}

export function loadAutoReadEnabled(
  context: vscode.ExtensionContext,
  _settingsDefault?: boolean
): boolean {
  const workspaceStored = context.workspaceState.get<boolean | undefined>(AUTO_READ_KEY);
  const globalStored = context.globalState.get<boolean | undefined>(AUTO_READ_KEY);
  const durable = readDurableAutoRead(workspacePersistKey());
  // File first: workspaceState is what a VSIX update can drop. Never fall back
  // to vartermCursor.autoReadAgentOutput — that leftover true turned Off back on.
  if (typeof durable === 'boolean') {
    thisWindowEnabled = durable;
  } else if (typeof globalStored === 'boolean') {
    thisWindowEnabled = globalStored;
  } else if (typeof workspaceStored === 'boolean') {
    thisWindowEnabled = workspaceStored;
  } else {
    thisWindowEnabled = false;
    void persistAutoReadEnabled(context, false);
  }
  return thisWindowEnabled;
}

export async function persistAutoReadEnabled(
  context: vscode.ExtensionContext,
  enabled: boolean
): Promise<void> {
  thisWindowEnabled = enabled;
  await context.workspaceState.update(AUTO_READ_KEY, enabled);
  await context.globalState.update(AUTO_READ_KEY, enabled);
  const key = workspacePersistKey();
  const store = readAutoReadStore();
  store.enabled = enabled;
  if (enabled) {
    store.workspaces = { ...store.workspaces, [key]: true };
  } else {
    // Off is global. Do not leave another folder's key at true.
    store.workspaces = {};
  }
  try {
    writeAutoReadStore(store);
  } catch {
    // Memory and VS Code state still hold this window.
  }
  try {
    await vscode.workspace
      .getConfiguration('vartermCursor')
      .update('autoReadAgentOutput', enabled, vscode.ConfigurationTarget.Global);
  } catch {
    // Settings UI can stay stale; the file is what restart reads.
  }
}

export function agentDropPath(): string {
  return path.join(os.homedir(), '.cursor', 'varterm-last-agent.json');
}

export async function installVartermAgentHook(extensionPath: string): Promise<void> {
  const hooksDir = path.join(os.homedir(), '.cursor', 'hooks');
  const hooksJsonPath = path.join(os.homedir(), '.cursor', 'hooks.json');
  const destScript = path.join(hooksDir, 'varterm-autoread.py');
  const srcScript = path.join(extensionPath, 'scripts', 'varterm-autoread.py');

  await fs.promises.mkdir(hooksDir, { recursive: true });
  await fs.promises.copyFile(srcScript, destScript);
  await fs.promises.chmod(destScript, 0o755);

  let existing: { version?: number; hooks?: Record<string, Array<{ command?: string }>> } = {
    version: 1,
    hooks: {},
  };
  try {
    existing = JSON.parse(await fs.promises.readFile(hooksJsonPath, 'utf8'));
  } catch {
    // Create a new user hooks file.
  }

  existing.version = existing.version || 1;
  existing.hooks = existing.hooks || {};
  const current = existing.hooks.afterAgentResponse || [];
  const ours = new Set([RELATIVE_HOOK_COMMAND, destScript]);
  const kept = current.filter((hook) => !ours.has(hook.command || ''));
  existing.hooks.afterAgentResponse = [...kept, { command: destScript }];

  await fs.promises.writeFile(hooksJsonPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
}

type ParsedDrop = {
  text: string;
  ts: number;
  cwd?: string;
  workspace?: string;
  conversationId?: string;
};

function parseDrop(raw: string): ParsedDrop | undefined {
  const parsed = JSON.parse(raw) as AgentDrop;
  const text = stripForSpeech(parsed.text || '');
  if (!text) {
    return undefined;
  }
  const conversationId = typeof parsed.conversationId === 'string' ? parsed.conversationId.trim() : '';
  return {
    text,
    ts: Number(parsed.ts) || 0,
    cwd: parsed.cwd,
    workspace: parsed.workspace,
    conversationId: conversationId || undefined,
  };
}

export function readLastAgentDrop(): ParsedDrop | undefined {
  try {
    return parseDrop(fs.readFileSync(agentDropPath(), 'utf8'));
  } catch {
    return undefined;
  }
}

function agentRepliesDir(): string {
  return path.join(os.homedir(), '.cursor', 'varterm-agent-replies');
}

/**
 * The newest reply this window is entitled to.
 *
 * The hook keeps a copy per project because the shared file holds one reply for
 * the whole machine: without the per-project copies, a window loses its own
 * reply the moment any other window gets an answer. The shared file is still
 * consulted last so a reply captured before this existed, or by a hook that has
 * not been refreshed yet, stays replayable.
 */
function listReplyDrops(): ParsedDrop[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(agentRepliesDir());
  } catch {
    names = [];
  }
  const drops: ParsedDrop[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue;
    }
    try {
      const drop = parseDrop(fs.readFileSync(path.join(agentRepliesDir(), name), 'utf8'));
      if (drop) {
        drops.push(drop);
      }
    } catch {
      // A half-written or hand-edited file should not hide the others.
    }
  }
  return drops;
}

function readOwnedAgentDrop(): ParsedDrop | undefined {
  const best = newestOwnedDrop(listReplyDrops(), windowWorkspaceRoots());
  if (best) {
    return best;
  }
  const shared = readLastAgentDrop();
  return shared && windowOwnsDrop(shared) ? shared : undefined;
}

const TRANSCRIPT_TAIL_BYTES = 512 * 1024;
let transcriptPathCache = new Map<string, string>();
let transcriptTextCache: { id: string; mtime: number; text: string } | undefined;

function cursorUserDir(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor', 'User');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Cursor', 'User');
  }
  return path.join(home, '.config', 'Cursor', 'User');
}

type SqlDb = {
  prepare: (sql: string) => { get: (...args: unknown[]) => unknown };
  close: () => void;
};

function openReadonlyDb(dbPath: string): SqlDb | undefined {
  try {
    const sqlite = nodeRequire('node:sqlite') as {
      DatabaseSync: new (filename: string, options?: { readOnly?: boolean }) => SqlDb;
    };
    return new sqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return undefined;
  }
}

function sqliteCell(dbPath: string, sql: string, param?: string): string {
  if (!fs.existsSync(dbPath)) {
    return '';
  }
  const db = openReadonlyDb(dbPath);
  if (db) {
    try {
      const row = param ? db.prepare(sql).get(param) : db.prepare(sql).get();
      if (row && typeof row === 'object' && 'value' in row && typeof row.value === 'string') {
        return row.value;
      }
    } catch {
      return '';
    } finally {
      try {
        db.close();
      } catch {
        // A locked Cursor database can fail on close after a successful read.
      }
    }
    return '';
  }
  try {
    if (param && !/^[A-Za-z0-9_./:-]+$/.test(param)) {
      return '';
    }
    const bound = param ? sql.replace('?', `'${param.replace(/'/g, '')}'`) : sql;
    const stdout = execFileSync('sqlite3', [dbPath, bound], {
      encoding: 'utf8',
      timeout: 1500,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.replace(/\n$/, '');
  } catch {
    return '';
  }
}

function parseStoredId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('"') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === 'string' ? parsed.trim() : '';
    } catch {
      return '';
    }
  }
  return trimmed;
}

function fileUrlPath(url: string): string {
  if (!url.startsWith('file://')) {
    return '';
  }
  let pathname = decodeURIComponent(url.slice('file://'.length));
  if (/^\/[A-Za-z]:\//.test(pathname)) {
    pathname = pathname.slice(1);
  }
  return pathname;
}

const workspaceDbCache = new Map<string, string>();

function workspaceDbForRoot(root: string): string {
  const cached = workspaceDbCache.get(root);
  if (cached) {
    return cached;
  }
  const storage = path.join(cursorUserDir(), 'workspaceStorage');
  let names: string[] = [];
  try {
    names = fs.readdirSync(storage);
  } catch {
    return '';
  }
  for (const name of names) {
    const marker = path.join(storage, name, 'workspace.json');
    let raw = '';
    try {
      raw = fs.readFileSync(marker, 'utf8');
    } catch {
      continue;
    }
    let folder = '';
    try {
      const parsed = JSON.parse(raw) as { folder?: unknown; workspace?: unknown };
      folder = fileUrlPath(typeof parsed.folder === 'string' ? parsed.folder : '');
      if (!folder && typeof parsed.workspace === 'string') {
        folder = fileUrlPath(parsed.workspace);
      }
    } catch {
      continue;
    }
    if (folder && (folder === root || root.startsWith(`${folder}${path.sep}`) || folder.startsWith(`${root}${path.sep}`))) {
      const db = path.join(storage, name, 'state.vscdb');
      workspaceDbCache.set(root, db);
      return db;
    }
  }
  workspaceDbCache.set(root, '');
  return '';
}

function sidebarFocusedId(roots: string[]): string {
  for (const root of roots) {
    const db = workspaceDbForRoot(root);
    if (!db) {
      continue;
    }
    const raw = sqliteCell(db, "SELECT value FROM ItemTable WHERE key = 'composer.composerData'");
    if (!raw) {
      continue;
    }
    try {
      const data = JSON.parse(raw) as { lastFocusedComposerIds?: unknown };
      const ids = Array.isArray(data.lastFocusedComposerIds) ? data.lastFocusedComposerIds : [];
      const first = ids.find((item) => typeof item === 'string' && item.trim());
      if (typeof first === 'string') {
        return first.trim();
      }
    } catch {
      // The next folder may still have a readable list.
    }
  }
  return '';
}

function glassSelectedId(): string {
  const db = path.join(cursorUserDir(), 'globalStorage', 'state.vscdb');
  return parseStoredId(
    sqliteCell(db, "SELECT value FROM ItemTable WHERE key = 'cursor/glass.selectedAgent'")
  );
}

function glassAgentOwned(id: string, roots: string[]): boolean {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) {
    return false;
  }
  const db = path.join(cursorUserDir(), 'globalStorage', 'state.vscdb');
  const raw = sqliteCell(db, 'SELECT value FROM composerHeaders WHERE composerId = ?', id);
  if (!raw) {
    return false;
  }
  try {
    const data = JSON.parse(raw) as {
      workspaceIdentifier?: { uri?: { fsPath?: string; path?: string } };
    };
    const fsPath = data.workspaceIdentifier?.uri?.fsPath || data.workspaceIdentifier?.uri?.path || '';
    return dropBelongsToRoots({ workspace: fsPath }, roots);
  } catch {
    return false;
  }
}

export function focusedComposerId(): string {
  return lookupFocusedComposerId() || '';
}

function lookupFocusedComposerId(): string | undefined {
  const roots = windowWorkspaceRoots();
  if (!roots.length) {
    return undefined;
  }
  const glass = glassSelectedId();
  return chooseFocusedComposerId({
    windowFocused: vscode.window.state.focused,
    sidebarFocusedId: sidebarFocusedId(roots),
    glassSelectedId: glass,
    glassOwned: Boolean(glass) && glassAgentOwned(glass, roots),
  });
}

function findTranscriptPath(conversationId: string): string {
  const cached = transcriptPathCache.get(conversationId);
  if (cached) {
    return cached;
  }
  const projects = path.join(os.homedir(), '.cursor', 'projects');
  let names: string[] = [];
  try {
    names = fs.readdirSync(projects);
  } catch {
    return '';
  }
  for (const name of names) {
    const file = path.join(projects, name, 'agent-transcripts', conversationId, `${conversationId}.jsonl`);
    if (fs.existsSync(file)) {
      transcriptPathCache.set(conversationId, file);
      return file;
    }
  }
  return '';
}

function readTranscriptReply(conversationId: string): string {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(conversationId)) {
    return '';
  }
  const file = findTranscriptPath(conversationId);
  if (!file) {
    return '';
  }
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return '';
  }
  if (transcriptTextCache?.id === conversationId && transcriptTextCache.mtime === mtime) {
    return transcriptTextCache.text;
  }
  let raw = '';
  try {
    const size = fs.statSync(file).size;
    if (size <= TRANSCRIPT_TAIL_BYTES) {
      raw = fs.readFileSync(file, 'utf8');
    } else {
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.alloc(TRANSCRIPT_TAIL_BYTES);
        fs.readSync(fd, buf, 0, TRANSCRIPT_TAIL_BYTES, size - TRANSCRIPT_TAIL_BYTES);
        raw = buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch {
    return '';
  }
  const text = lastAssistantTextFromTranscript(raw);
  transcriptTextCache = { id: conversationId, mtime, text };
  return text;
}

function textForConversation(conversationId: string): string {
  const captured = dropForConversation(listReplyDrops(), conversationId);
  if (captured?.text) {
    return captured.text;
  }
  return stripForSpeech(readTranscriptReply(conversationId));
}

/**
 * The reply for the chat tab in front, not the newest reply in the project.
 *
 * With several sidebar tabs open, the newest file is whichever agent finished
 * last — often a different tab, or text the user copied out of a plan. When
 * no tab can be resolved, the newest reply this window owns is still the best
 * guess.
 */
function readFocusedAgentText(): string {
  const focused = lookupFocusedComposerId();
  if (focused) {
    return textForConversation(focused);
  }
  return readOwnedAgentDrop()?.text || '';
}

export function readLastAgentText(): string {
  return readFocusedAgentText();
}

export function agentReplyMissingMessage(): string {
  const focused = lookupFocusedComposerId();
  if (focused && !textForConversation(focused)) {
    return 'This chat has no reply to read yet. Stay on this tab until the reply finishes.';
  }
  if (lastAgentReplyIsFromAnotherWindow()) {
    return 'The last agent reply belongs to another window. Varterm only replays replies from this one.';
  }
  return 'No agent reply captured yet. Leave Auto-read on and wait for a reply to finish.';
}

/** Distinguishes "nothing captured" from "captured, but not ours" when reporting. */
export function lastAgentReplyIsFromAnotherWindow(): boolean {
  const drop = readLastAgentDrop();
  return Boolean(drop) && !windowOwnsDrop(drop!);
}

let ownedReplyCache: { at: number; value: boolean } | undefined;

/** Called when the drop file changes, so the cache cannot outlive the answer. */
export function forgetAgentReplyCache(): void {
  ownedReplyCache = undefined;
}

/**
 * Called from the status bar refresh, which fires on every playback state
 * change, so the answer is cached briefly. It only changes when a reply lands.
 */
export function hasAgentReplyForThisWindow(): boolean {
  const now = Date.now();
  if (ownedReplyCache && now - ownedReplyCache.at < 2000) {
    return ownedReplyCache.value;
  }
  const value = Boolean(readLastAgentText());
  ownedReplyCache = { at: now, value };
  return value;
}

/** Hook timestamps are Unix seconds; tolerate millisecond values from older files. */
export function agentDropAgeMs(ts: number): number {
  if (!ts) {
    return Number.POSITIVE_INFINITY;
  }
  const writtenAt = ts > 1e12 ? ts : ts * 1000;
  return Date.now() - writtenAt;
}

export function stripForSpeech(text: string): string {
  return text
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/___([^_]+)___/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*_]){3,}[ \t]*$/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
    .replace(/^[ \t]*\d+\.[ \t]+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, '$1')
    .replace(/\\[ \t]*$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function windowWorkspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
}

function windowOwnsDrop(drop: AgentDrop): boolean {
  return dropBelongsToRoots(drop, windowWorkspaceRoots());
}

function claimDelayMs(drop: AgentDrop): number {
  return autoReadClaimDelayMs({
    isAgentsWindow: windowIsAgentsWindow(),
    editorAutoRead: isAutoReadAllowed(),
    agentsWindowAutoRead: getAgentsWindowAutoRead(),
    ownsWorkspace: windowOwnsDrop(drop),
    focused: vscode.window.state.focused,
  });
}

function tryClaimAutoReadEvent(ts: number): boolean {
  const claimsDir = path.join(os.homedir(), '.cursor', 'varterm-autoread-claims');
  fs.mkdirSync(claimsDir, { recursive: true });
  const stamp = String(ts).replace(/[^\d.]/g, '_');
  const lockPath = path.join(claimsDir, `${stamp}.lock`);
  try {
    fs.writeFileSync(lockPath, `${process.pid}\n`, { flag: 'wx' });
  } catch {
    return false;
  }

  try {
    const names = fs.readdirSync(claimsDir);
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const name of names) {
      if (name === `${stamp}.lock`) {
        continue;
      }
      const full = path.join(claimsDir, name);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) {
          fs.unlinkSync(full);
        }
      } catch {
        // Ignore stale cleanup failures.
      }
    }
  } catch {
    // Ignore cleanup failures.
  }
  return true;
}

export function watchAgentDropFile(
  onText: (text: string, markHeard: () => void) => void | Promise<void>,
  log: (message: string) => void
): { dispose: () => void } {
  const filePath = agentDropPath();
  const dirPath = path.dirname(filePath);
  fs.mkdirSync(dirPath, { recursive: true });
  let lastTs = 0;
  let inFlightTs = 0;
  let disposed = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingClaims = new Set<ReturnType<typeof setTimeout>>();
  const claimedHere = new Set<number>();
  const retried = new Set<number>();

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as AgentDrop;
    lastTs = Number(parsed.ts) || 0;
  } catch {
    lastTs = 0;
  }

  const markHeardTs = (ts: number): void => {
    if (ts > lastTs) {
      lastTs = ts;
    }
  };

  const isCancelled = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const name = 'name' in error ? String(error.name) : '';
    const message = 'message' in error ? String(error.message) : '';
    return name === 'ReadCancelledError' || message === 'Cancelled' || message === 'Operation cancelled';
  };

  const handle = (): void => {
    if (debounce) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(() => {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AgentDrop;
        const ts = Number(parsed.ts) || 0;
        const text = stripForSpeech(parsed.text || '');
        if (!text || ts <= lastTs || ts === inFlightTs || text.length < 8) {
          return;
        }
        const delay = claimDelayMs(parsed);
        if (delay < 0) {
          log(
            `Auto-read skipped: agentsWindow=${windowIsAgentsWindow()} owns=${windowOwnsDrop(parsed)}`
          );
          markHeardTs(ts);
          return;
        }
        inFlightTs = ts;
        log(
          `Auto-read saw ${text.length} chars focused=${vscode.window.state.focused} owns=${windowOwnsDrop(parsed)} delay=${delay}ms`
        );
        const claimTimer = setTimeout(() => {
          pendingClaims.delete(claimTimer);
          if (disposed) {
            if (inFlightTs === ts) {
              inFlightTs = 0;
            }
            return;
          }
          if (!claimedHere.has(ts) && !tryClaimAutoReadEvent(ts)) {
            log('Auto-read skipped: another window already claimed this reply');
            markHeardTs(ts);
            if (inFlightTs === ts) {
              inFlightTs = 0;
            }
            return;
          }
          claimedHere.add(ts);
          log(`Auto-read playing in this window (${text.length} chars)`);
          let heard = false;
          const markHeard = () => {
            heard = true;
            markHeardTs(ts);
          };
          void Promise.resolve(onText(text, markHeard)).then(
            () => {
              markHeardTs(ts);
              if (inFlightTs === ts) {
                inFlightTs = 0;
              }
            },
            (error) => {
              if (heard || isCancelled(error)) {
                markHeardTs(ts);
                if (inFlightTs === ts) {
                  inFlightTs = 0;
                }
                if (isCancelled(error)) {
                  log('Auto-read replaced by another read');
                }
                return;
              }
              const message = error instanceof Error ? error.message : String(error);
              log(`Auto-read play error: ${message}`);
              if (inFlightTs === ts) {
                inFlightTs = 0;
              }
              if (!retried.has(ts) && !disposed) {
                retried.add(ts);
                log('Auto-read will retry this reply once');
                retryTimer = setTimeout(handle, 1200);
                return;
              }
              markHeardTs(ts);
            }
          );
        }, delay);
        pendingClaims.add(claimTimer);
      } catch (error) {
        log(`Auto-read watch error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 250);
  };

  const watcher = fs.watch(dirPath, (event, filename) => {
    if (!filename || filename.toString() !== 'varterm-last-agent.json') {
      return;
    }
    if (event === 'change' || event === 'rename') {
      handle();
    }
  });

  return {
    dispose: () => {
      disposed = true;
      if (debounce) {
        clearTimeout(debounce);
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      for (const timer of pendingClaims) {
        clearTimeout(timer);
      }
      pendingClaims.clear();
      watcher.close();
    },
  };
}
