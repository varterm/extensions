import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

export const AUTO_READ_KEY = 'vartermCursor.autoReadAgentOutput';
const RELATIVE_HOOK_COMMAND = './hooks/varterm-autoread.py';

type AgentDrop = { text?: string; ts?: number; cwd?: string; workspace?: string };

/** This extension host / window only. Do not read settings or globalState here. */
let thisWindowEnabled = false;

export function getAutoReadEnabled(_context?: vscode.ExtensionContext): boolean {
  return thisWindowEnabled;
}

export function loadAutoReadEnabled(
  context: vscode.ExtensionContext,
  settingsDefault: boolean
): boolean {
  const stored = context.workspaceState.get<boolean | undefined>(AUTO_READ_KEY);
  thisWindowEnabled = typeof stored === 'boolean' ? stored : settingsDefault;
  return thisWindowEnabled;
}

export async function persistAutoReadEnabled(
  context: vscode.ExtensionContext,
  enabled: boolean
): Promise<void> {
  thisWindowEnabled = enabled;
  await context.workspaceState.update(AUTO_READ_KEY, enabled);
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

export function readLastAgentText(): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(agentDropPath(), 'utf8')) as AgentDrop;
    return stripForSpeech(parsed.text || '');
  } catch {
    return '';
  }
}

export function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
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
