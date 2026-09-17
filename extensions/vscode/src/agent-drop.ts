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
