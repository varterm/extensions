import * as path from 'node:path';

export type DropOrigin = { cwd?: string; workspace?: string };

/**
 * Whether a captured agent reply came from one of this window's folders.
 *
 * Every Cursor window writes to one shared drop file, so this is what keeps a
 * replay from speaking another project's answer. The separator in the prefix
 * test is load-bearing: without it `/src/varterm` would claim a reply from
 * `/src/varterm-plat`.
 */
export function dropBelongsToRoots(
  drop: DropOrigin,
  roots: string[],
  sep: string = path.sep
): boolean {
  const candidates = [drop.workspace, drop.cwd].filter((value): value is string => Boolean(value));
  if (!roots.length || !candidates.length) {
    return false;
  }
  return candidates.some((candidate) =>
    roots.some((root) => candidate === root || candidate.startsWith(`${root}${sep}`))
  );
}

/**
 * Whether audio already in hand is still worth replaying.
 *
 * A window does not play every reply, so holding audio is not proof of holding
 * the latest one. With nothing on disk to compare against the cache wins, since
 * it is the only thing left; otherwise the texts have to agree.
 */
export function cacheIsCurrent(cachedText: string, newestText: string): boolean {
  return !newestText || newestText === cachedText;
}

/**
 * The most recent reply among those this window may replay.
 *
 * A multi-root window can own more than one project's replies, so ownership
 * alone does not pick a winner and the newest timestamp decides.
 */
export function newestOwnedDrop<T extends DropOrigin & { ts: number }>(
  drops: T[],
  roots: string[],
  sep: string = path.sep
): T | undefined {
  let best: T | undefined;
  for (const drop of drops) {
    if (!dropBelongsToRoots(drop, roots, sep)) {
      continue;
    }
    if (!best || drop.ts > best.ts) {
      best = drop;
    }
  }
  return best;
}

/**
 * Which chat the replay button should speak.
 *
 * Sidebar tabs and the Agents window are different lists. The Agents window
 * selection is global, so a background window must not adopt it — that is some
 * other window's tab. The front window uses it, because that is the chat the
 * user is looking at, whether it lives in the sidebar or the Agents window.
 */
export function chooseFocusedComposerId(input: {
  windowFocused: boolean;
  sidebarFocusedId?: string;
  glassSelectedId?: string;
  glassOwned: boolean;
}): string | undefined {
  const sidebar = input.sidebarFocusedId?.trim() || undefined;
  const glass = input.glassOwned ? input.glassSelectedId?.trim() || undefined : undefined;
  if (input.windowFocused && glass) {
    return glass;
  }
  return sidebar;
}

/**
 * Who speaks a finished reply.
 *
 * Cursor does not start this extension inside the Agents window, so an editor
 * speaks those replies when the Agents window switch is on. That editor does
 * not have to own the project. With the switch off, an editor reads only its
 * own project.
 *
 * A negative delay means this window stays quiet.
 */
export function autoReadClaimDelayMs(input: {
  isAgentsWindow: boolean;
  editorAutoRead: boolean;
  agentsWindowAutoRead: boolean;
  ownsWorkspace: boolean;
  focused: boolean;
}): number {
  if (input.isAgentsWindow) {
    return input.agentsWindowAutoRead ? 0 : -1;
  }
  if (input.agentsWindowAutoRead) {
    return input.focused ? 40 : 80;
  }
  if (!input.editorAutoRead || !input.ownsWorkspace) {
    return -1;
  }
  return input.focused ? 0 : 40;
}

/** The reply captured for one chat, not the newest chat in the project. */
export function dropForConversation<T extends { conversationId?: string; ts: number }>(
  drops: T[],
  conversationId: string
): T | undefined {
  const id = conversationId.trim();
  if (!id) {
    return undefined;
  }
  let best: T | undefined;
  for (const drop of drops) {
    if (drop.conversationId !== id) {
      continue;
    }
    if (!best || drop.ts > best.ts) {
      best = drop;
    }
  }
  return best;
}

function transcriptContentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    const item = part as { type?: unknown; text?: unknown };
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text);
    }
  }
  return parts.join('\n');
}

/**
 * The last assistant message in a Cursor agent transcript.
 *
 * A tail read can start mid-line, so a fragment that is not JSON is skipped.
 * Tool-only messages have no text and do not replace a real reply.
 */
export function lastAssistantTextFromTranscript(jsonl: string): string {
  let last = '';
  for (const rawLine of jsonl.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') {
      continue;
    }
    const record = parsed as { role?: unknown; message?: { content?: unknown } };
    if (record.role !== 'assistant') {
      continue;
    }
    const text = transcriptContentText(record.message?.content).trim();
    if (text) {
      last = text;
    }
  }
  return last;
}
