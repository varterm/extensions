import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

export const AUTO_READ_KEY = 'vartermCursor.autoReadAgentOutput';
const HOOK_COMMAND = './hooks/varterm-autoread.py';

type AgentDrop = { text?: string; ts?: number };

export function getAutoReadEnabled(context: vscode.ExtensionContext): boolean {
  return Boolean(context.globalState.get<boolean>(AUTO_READ_KEY));
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
  if (!current.some((hook) => hook.command === HOOK_COMMAND)) {
    existing.hooks.afterAgentResponse = [...current, { command: HOOK_COMMAND }];
  }

  await fs.promises.writeFile(hooksJsonPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
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

export function watchAgentDropFile(
  onText: (text: string) => void,
  log: (message: string) => void
): { dispose: () => void } {
  const filePath = agentDropPath();
  let lastTs = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as AgentDrop;
    lastTs = Number(parsed.ts) || 0;
  } catch {
    lastTs = 0;
  }

  const handle = (): void => {
    if (debounce) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(() => {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AgentDrop;
        const ts = Number(parsed.ts) || 0;
        const text = stripForSpeech(parsed.text || '');
        if (!text || ts <= lastTs || text.length < 8) {
          return;
        }
        lastTs = ts;
        log(`Auto-read picked up text (${text.length} chars)`);
        onText(text);
      } catch (error) {
        log(`Auto-read watch error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 250);
  };

  const watcher = fs.watch(path.dirname(filePath), (event, filename) => {
    if (!filename || filename.toString() !== 'varterm-last-agent.json') {
      return;
    }
    if (event === 'change' || event === 'rename') {
      handle();
    }
  });

  return {
    dispose: () => {
      if (debounce) {
        clearTimeout(debounce);
      }
      watcher.close();
    },
  };
}
