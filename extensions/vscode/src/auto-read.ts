import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

export const AUTO_READ_KEY = 'vartermCursor.autoReadAgentOutput';
const RELATIVE_HOOK_COMMAND = './hooks/varterm-autoread.py';
const STORE_NAME = 'varterm-autoread.json';

type AgentDrop = { text?: string; ts?: number; cwd?: string; workspace?: string };
type AutoReadStore = { enabled?: boolean; workspaces?: Record<string, boolean> };

/** This extension host / window only. Do not read settings here. */
let thisWindowEnabled = false;

export function getAutoReadEnabled(_context?: vscode.ExtensionContext): boolean {
  return thisWindowEnabled;
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

export function readLastAgentDrop(): { text: string; ts: number } | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(agentDropPath(), 'utf8')) as AgentDrop;
    const text = stripForSpeech(parsed.text || '');
    if (!text) {
      return undefined;
    }
    return { text, ts: Number(parsed.ts) || 0 };
  } catch {
    return undefined;
  }
}

export function readLastAgentText(): string {
  return readLastAgentDrop()?.text || '';
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
  const roots = windowWorkspaceRoots();
  const candidates = [drop.workspace, drop.cwd].filter((value): value is string => Boolean(value));
  if (!roots.length || !candidates.length) {
    return false;
  }
  return candidates.some((candidate) =>
    roots.some((root) => candidate === root || candidate.startsWith(`${root}${path.sep}`))
  );
}

function claimDelayMs(drop: AgentDrop): number {
  const owns = windowOwnsDrop(drop);
  const focused = vscode.window.state.focused;
  if (owns && focused) {
    return 0;
  }
  if (owns) {
    return 40;
  }
  if (focused) {
    return 80;
  }
  return 280;
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
        if (!isAutoReadAllowed()) {
          log('Auto-read skipped: off');
          markHeardTs(ts);
          return;
        }
        inFlightTs = ts;
        const delay = claimDelayMs(parsed);
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
