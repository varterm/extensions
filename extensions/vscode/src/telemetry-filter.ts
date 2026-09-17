// What is worth waking someone up for. Kept apart from telemetry.ts so it can be
// tested without an editor around it.

export const SKIP_MESSAGES = [
  'Cancelled',
  'Operation cancelled',
  'Nothing is playing.',
  'Nothing is paused.',
  'No audio to replay yet.',
  'No agent reply captured yet',
  'No text available to read aloud',
  'That text has nothing to read aloud',
  'Background playback currently uses macOS afplay',
];

/**
 * 422 and 429 are the service refusing on purpose and saying why: nothing
 * speakable in the text, a voice that cannot read that script, or too many
 * requests. The user saw the reason and can act on it, so reporting them only
 * buries the failures that are ours.
 *
 * Other 4xx still report. The extension chunks to 450 characters and builds its
 * own payloads, so a 400 means this code sent a bad request — exactly the kind
 * of thing the reports exist to catch.
 */
export function isExpectedRefusal(error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return status === 422 || status === 429;
}

export function shouldReportError(error: unknown): boolean {
  if (isExpectedRefusal(error)) {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  return !SKIP_MESSAGES.some((skip) => message.includes(skip));
}
